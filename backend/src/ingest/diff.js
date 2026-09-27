// Unified-diff parsing + PR context extraction.
// Accepts either a raw unified diff text or a repo path + git ref range.

import { execFileSync } from 'node:child_process';

/**
 * Parse a unified diff into structured hunks.
 * @returns {{files: Array<{path, additions, deletions, hunks: Array<{header, lines: string[]}>}>}}
 */
export function parseUnifiedDiff(diffText) {
  const files = [];
  const lines = diffText.split(/\r?\n/);
  let current = null;
  let currentHunk = null;

  for (const line of lines) {
    const fileMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line) ||
      /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/.exec(line);
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      current = { path: m ? m[2] : line.slice(11), additions: 0, deletions: 0, hunks: [] };
      files.push(current);
      currentHunk = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      if (current && p !== '/dev/null') current.path = p.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
      currentHunk = { header: line, oldStart: m ? +m[1] : 0, newStart: m ? +m[3] : 0, lines: [] };
      if (current) current.hunks.push(currentHunk);
      continue;
    }
    if (currentHunk) {
      if (line.startsWith('+')) { current.additions++; currentHunk.lines.push(line); }
      else if (line.startsWith('-')) { current.deletions++; currentHunk.lines.push(line); }
      else if (line.startsWith(' ') || line === '') currentHunk.lines.push(line);
      else if (line.startsWith('diff --git') || line.startsWith('index ')) { /* handled above / ignore */ }
      else currentHunk.lines.push(line);
    }
  }

  // Remove the stray non-file entries if any path header didn't match
  return { files: files.filter((f) => f.path && !f.path.startsWith('diff ')) };
}

/**
 * Produce PR context: touched files with added/removed lines (for downstream checks).
 */
export function buildDiffContext(parsed) {
  return parsed.files.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    changedLines: f.hunks.flatMap((h) =>
      h.lines.filter((l) => l.startsWith('+') || l.startsWith('-')).map((l) => ({
        kind: l[0] === '+' ? 'add' : 'del',
        text: l.slice(1),
      }))
    ),
  }));
}

/** Get a unified diff for repoPath between refs (e.g. "main..feature/x", or "HEAD~1..HEAD"). */
export function gitDiff(repoPath, refRange) {
  return execFileSync('git', ['-C', repoPath, 'diff', refRange], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
