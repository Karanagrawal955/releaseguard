// Document Understanding: build the "claimed behavior" baseline from
// README, CONTRIBUTING, inline comments, and existing tests.

import fs from 'node:fs';
import path from 'node:path';

const DOC_FILES = ['README.md', 'CONTRIBUTING.md', 'README', 'docs/README.md', 'ARCHITECTURE.md'];
const DOC_EXTENSIONS = ['.md', '.mdx', '.txt'];

function safeRead(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// Always use forward slashes in claim sources so they compare equal to
// diff paths (which come from `git diff`, always POSIX-style).
const posix = (p) => p.split(path.sep).join('/');

function listFilesRecursive(dir, { max = 400, skip = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']) } = {}) {
  const out = [];
  const walk = (d, depth) => {
    if (out.length >= max || depth > 6) return;
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

/**
 * Extract "claims" from documentation: sentences that assert how code behaves.
 * Heuristics:
 *  - Markdown bullets/paragraphs mentioning `identifiers(...)` or backticked names
 *  - "returns", "throws", "includes", "excludes", "always", "never", "defaults to" etc.
 * Each claim: { source, line, subject, claim }
 */
export function extractClaimsFromDoc(text, source) {
  const claims = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('<!--')) return;
    // Only consider prose-ish lines (skip pure code fences content heuristically)
    const hasIdentifier = /[A-Za-z_$][\w$.]*\s*\(/.test(line) || /`[^`]+`/.test(line);
    const assertion = /\b(returns?|throws?|includes?|excludes?|always|never|default(?:s)? to|will|must|should|does not|doesn't|is|are)\b/i.test(line);
    if (!hasIdentifier || !assertion) return;
    const subjectMatch = /`([^`]+)`/.exec(line) || /([A-Za-z_$][\w$.]*\s*\([^)]*\))/.exec(line);
    if (!subjectMatch) return;
    claims.push({
      source,
      line: i + 1,
      subject: subjectMatch[1].replace(/\s+/g, ' ').trim(),
      claim: line.replace(/^[-*#>\s]+/, ''),
    });
  });
  return claims;
}

/**
 * Extract claims from inline comments in source files.
 * Recognizes `//`, `#`, `/* *\/` comment lines that make behavior assertions.
 */
export function extractClaimsFromComments(text, source) {
  const claims = [];
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  lines.forEach((raw, i) => {
    let line = raw.trim();
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end !== -1) {
        line = line.slice(0, end).replace(/^[*!\s]+/, '');
        inBlock = false;
      }
      if (!line) return;
    } else if (line.startsWith('/*')) {
      line = line.replace(/^\/\*+/, '').trim();
      if (!line.includes('*/')) inBlock = true;
      else line = line.slice(0, line.indexOf('*/'));
    } else if (line.startsWith('//') || line.startsWith('#')) {
      line = line.replace(/^(\/\/+|#+)\s?/, '');
    } else return;

    const assertion = /\b(returns?|throws?|includes?|excludes?|always|never|default(?:s)? to|will|must|should|does not|doesn't)\b/i.test(line);
    if (!assertion || line.length < 12) return;
    const subjectMatch = /`([^`]+)`/.exec(line) || /([A-Za-z_$][\w$.]*\s*\([^)]*\))/.exec(line);
    claims.push({
      source,
      line: i + 1,
      subject: subjectMatch ? subjectMatch[1].replace(/\s+/g, ' ').trim() : '(context)',
      claim: line,
    });
  });
  return claims;
}

/**
 * Which behavior is already pinned by tests?
 * Returns array of { file, subject, testBodySnippet }
 */
export function extractTestedBehavior(repoPath) {
  const tested = [];
  const files = listFilesRecursive(repoPath);
  const testFileRe = /(\.test\.|\.spec\.|_test\.|test_)/i;
  for (const f of files) {
    const base = path.basename(f);
    if (!testFileRe.test(base) && !base.startsWith('test')) continue;
    const text = safeRead(f);
    if (!text) continue;
    const rel = posix(path.relative(repoPath, f));
    // Test names / assertions referencing identifiers
    const idRe = /\b([a-zA-Z_$][\w$.]*)\s*\(/g;
    let m;
    const seen = new Set();
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (!/\b(it|test|describe|assert|expect|should)\b/i.test(line)) return;
      idRe.lastIndex = 0;
      while ((m = idRe.exec(line))) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        tested.push({ file: rel, line: idx + 1, subject: name, testBodySnippet: line.trim().slice(0, 160) });
      }
    });
  }
  return tested;
}

/** Discover source files (non-test) for the repo. */
export function listSourceFiles(repoPath) {
  const skipExt = new Set(DOC_EXTENSIONS.concat(['.json', '.lock', '.png', '.jpg', '.svg', '.ico', '.map']));
  return listFilesRecursive(repoPath)
    .filter((f) => !skipExt.has(path.extname(f).toLowerCase()))
    .filter((f) => !/(\.test\.|\.spec\.|_test\.)/i.test(path.basename(f)));
}

/**
 * Build the full claimed-behavior baseline.
 * @returns {{docs: Array, claims: Array, comments: Array, tested: Array, files: string[]}}
 */
export function buildBaseline(repoPath) {
  const docs = [];
  const claims = [];
  // Every source-file path mentioned anywhere in a doc file (module maps,
  // "see src/x.js" pointers). Used by the knowledge-gap check to decide
  // whether a file is documented — claims alone miss module-map bullets.
  const docMentions = new Set();
  const noteMentions = (text) => {
    for (const m of text.matchAll(/[\w./\\-]+\.(?:js|mjs|cjs|ts|jsx|tsx)\b/g)) {
      docMentions.add(m[0].split(/[\\/]/).pop());
    }
  };

  for (const name of DOC_FILES) {
    const p = path.join(repoPath, name);
    const text = safeRead(p);
    if (text) {
      docs.push({ path: name, chars: text.length });
      claims.push(...extractClaimsFromDoc(text, name));
      noteMentions(text);
    }
  }
  // Any other markdown files in the tree
  for (const f of listFilesRecursive(repoPath, { max: 100 })) {
    if (!DOC_EXTENSIONS.includes(path.extname(f).toLowerCase())) continue;
    const rel = posix(path.relative(repoPath, f));
    if (docs.some((d) => d.path === rel)) continue;
    const text = safeRead(f);
    if (text) {
      docs.push({ path: rel, chars: text.length });
      claims.push(...extractClaimsFromDoc(text, rel));
      noteMentions(text);
    }
  }

  // Inline comments across source files
  const comments = [];
  const sourceFiles = listSourceFiles(repoPath);
  for (const f of sourceFiles) {
    const text = safeRead(f);
    if (!text) continue;
    const rel = posix(path.relative(repoPath, f));
    comments.push(...extractClaimsFromComments(text, rel));
  }

  const tested = extractTestedBehavior(repoPath);

  return { docs, claims, comments, tested, docMentions: [...docMentions], sourceFiles: sourceFiles.map((f) => posix(path.relative(repoPath, f))) };
}
