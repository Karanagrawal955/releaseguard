// Deterministic evidence for each check. The subagents read these bundles so
// they reason over pre-extracted facts instead of re-scanning the whole repo.

import fs from 'node:fs';
import path from 'node:path';

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.java', '.rb', '.rs', '.php', '.cs', '.cpp', '.c', '.h']);

function safeRead(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function listFiles(dir, skip = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.rg-work']), max = 500) {
  const out = [];
  const walk = (d, depth) => {
    if (out.length >= max || depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else out.push(full);
    }
  };
  walk(dir, 0);
  return out;
}

/** Extract changed symbols from +/- diff lines. */
export function extractChangedSymbols(diffContext) {
  const defRe = /(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)|(?:export\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*[:(=]/;
  const out = [];
  for (const f of diffContext) {
    const symbols = new Set();
    for (const cl of f.changedLines) {
      const src = cl.text;
      if (cl.kind === 'add' || cl.kind === 'del') {
        const fn = /\b(?:function|def|func|method)\s+([A-Za-z_$][\w$]*)/.exec(src);
        if (fn) symbols.add(fn[1]);
        const arrow = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.exec(src);
        if (arrow) symbols.add(arrow[1]);
        const cls = /\bclass\s+([A-Za-z_$][\w$]*)/.exec(src);
        if (cls) symbols.add(cls[1]);
        const py = /^\s*def\s+([A-Za-z_]\w*)/.exec(src);
        if (py) symbols.add(py[1]);
        const method = /^\s*(?:export\s+)?(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/.exec(src);
        if (method && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(method[1])) symbols.add(method[1]);
      }
    }
    out.push({ file: f.path, symbols: [...symbols], additions: f.additions, deletions: f.deletions });
  }
  return out;
}

/** (a) Test coverage: for each touched file, which tests exist and which touched symbols are referenced by any test? */
export function testCoverageEvidence({ repoPath, diffContext, baseline }) {
  const allFiles = listFiles(repoPath);
  const testFiles = allFiles.filter((f) => /(\.test\.|\.spec\.|_test\.)/i.test(path.basename(f)) || /(^|[\\/])tests?[\\/]/i.test(f));
  const touched = extractChangedSymbols(diffContext);

  const testContents = testFiles.map((f) => ({
    path: path.relative(repoPath, f).split(path.sep).join('/'),
    content: (safeRead(f) || '').slice(0, 20000),
  }));
  const testBlob = testContents.map((t) => t.content).join('\n');

  const perFile = touched.map((t) => {
    const sameDirTests = testContents.filter(
      (tc) => path.dirname(tc.path) === path.dirname(t.file) || tc.path.includes(path.basename(t.file).replace(/\.[^.]+$/, ''))
    );
    // Union: symbols seen in the diff AND function declarations in the touched
    // file itself (a body-only change wouldn't name the function in the diff).
    const symbols = new Set([...t.symbols, ...declaredFunctions(repoPath, t.file)]);
    const untestedSymbols = [...symbols].filter((s) => {
      const re = new RegExp(`\\b${s.replace(/\$/g, '\\$')}\\b`);
      return !re.test(testBlob);
    });
    return {
      file: t.file,
      touchedSymbols: [...symbols],
      untestedSymbols,
      relatedTests: sameDirTests.map((x) => x.path),
      additions: t.additions,
      deletions: t.deletions,
    };
  });

  return {
    testFiles: testContents.map((t) => t.path),
    testFileCount: testContents.length,
    touchedFiles: perFile,
    repoHasTests: testContents.length > 0,
    note: 'untestedSymbols are touched symbols with no reference in any test file in the repo',
  };
}

/** Declared function/method/class names inside a repo file (current content). */
export function declaredFunctions(repoPath, relFile) {
  const text = safeRead(path.join(repoPath, relFile));
  if (!text || text.length > 400000) return [];
  const names = new Set();
  const patterns = [
    /\b(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*def\s+([A-Za-z_]\w*)/gm,
    /^\s*(?:public|private|protected|static|\s)*([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/gm,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const n = m[1];
      if (n && !['if', 'for', 'while', 'switch', 'catch', 'return', 'constructor'].includes(n)) names.add(n);
    }
  }
  return [...names].slice(0, 40);
}

/** (b) Docs-vs-behavior: claims whose subject appears in touched code, with the actual code snippet. */
export function docsBehaviorEvidence({ repoPath, diffContext, baseline }) {
  const touchedPaths = new Set(diffContext.map((d) => d.path));
  const changedText = diffContext
    .flatMap((d) => d.changedLines.map((c) => c.text))
    .join('\n');
  // Symbols declared inside files the PR touches (a body-only change may not
  // name the symbol in the diff, but the claim is still in scope).
  const declaredInTouched = new Set();
  for (const p of touchedPaths) {
    for (const fn of declaredFunctions(repoPath, p)) declaredInTouched.add(fn);
  }

  const allClaims = [...(baseline.claims || []), ...(baseline.comments || [])];
  const relevant = [];
  for (const claim of allClaims) {
    // Subject referenced in changed lines, declared in a touched file, OR the
    // claim's source file itself is touched.
    const subjCore = claim.subject.replace(/\(.*\)/, '').replace(/`/g, '').trim();
    const inDiff = subjCore && (changedText.includes(subjCore) || declaredInTouched.has(subjCore));
    const fileTouched = touchedPaths.has(claim.source);
    if (inDiff || fileTouched) {
      // Locate the subject definition/usage in the repo
      const snippet = findSymbolSnippet(repoPath, subjCore);
      relevant.push({ ...claim, referencedInDiff: inDiff, sourceFileTouched: fileTouched, codeSnippet: snippet });
    }
  }

  // Also include claims from docs about touched files even if subject unknown
  const docClaimsAboutTouched = allClaims.filter((c) => touchedPaths.has(c.source));

  return {
    baselineClaimCount: allClaims.length,
    relevantClaims: relevant,
    docSources: baseline.docs.map((d) => d.path),
    touchedFiles: [...touchedPaths],
    sampleOfAllClaims: allClaims.slice(0, 40),
    docClaimsAboutTouched,
  };
}

function findSymbolSnippet(repoPath, symbol) {
  if (!symbol) return null;
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const files = listFiles(repoPath, new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.rg-work']), 200);
  for (const f of files) {
    if (!CODE_EXT.has(path.extname(f).toLowerCase())) continue;
    const text = safeRead(f);
    if (!text || text.length > 400000) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(symbol) && /(function|=>|return|class|def|const|var|let)/.test(lines[i])) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 8);
        return {
          file: path.relative(repoPath, f).split(path.sep).join('/'),
          line: i + 1,
          snippet: lines.slice(start, end).join('\n'),
        };
      }
    }
  }
  return null;
}

/** (d) Breaking change: exported/declared signature diff + call sites elsewhere. */
export function breakingChangeEvidence({ repoPath, diffContext, baseline }) {
  const touched = extractChangedSymbols(diffContext);
  const allFiles = listFiles(repoPath);

  // Signature-ish lines from the diff for touched files
  const signatures = diffContext.map((f) => ({
    file: f.path,
    changedLines: f.changedLines
      .filter((c) => /(function|class|def|=>|return|export|module\.exports|interface|type |=>)/.test(c.text))
      .map((c) => ({ kind: c.kind, text: c.text.trim().slice(0, 300) })),
  }));

  // Find call sites of changed symbols OUTSIDE the touched files.
  // Include function declarations read from the touched file itself.
  const callSites = [];
  for (const t of touched) {
    const symbols = [...new Set([...t.symbols, ...declaredFunctions(repoPath, t.file)])];
    for (const sym of symbols) {
      if (sym.length < 3) continue;
      const re = new RegExp(`\\b${sym.replace(/\$/g, '\\$')}\\s*\\(`);
      const sites = [];
      for (const f of allFiles) {
        const rel = path.relative(repoPath, f).replace(/\\/g, '/');
        if (rel === t.file || !CODE_EXT.has(path.extname(f).toLowerCase())) continue;
        if (/(\.test\.|\.spec\.|_test\.)/i.test(path.basename(f))) continue;
        const text = safeRead(f);
        if (!text || text.length > 300000) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) sites.push({ file: rel, line: i + 1, code: lines[i].trim().slice(0, 200) });
          if (sites.length >= 8) break;
        }
        if (sites.length >= 8) break;
      }
      if (sites.length) callSites.push({ symbol: sym, changedIn: t.file, sites });
    }
  }

  return { signatures, changedSymbols: touched, externalCallSites: callSites };
}
