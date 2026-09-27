// Git history / ownership extraction for touched files.

import { execFileSync } from 'node:child_process';

function git(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

export function isGitRepo(repoPath) {
  try {
    return git(repoPath, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

/** Days since a given commit date (ISO-ish string from git). */
function daysSince(dateStr) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return Math.round((Date.now() - t) / 86400000);
}

/**
 * Ownership/history evidence for a set of file paths.
 * @returns {Array<{file, lastTouchDays, lastAuthor, lastEmail, commitCount, authors: string[], topAuthor, summary}>}
 */
export function fileOwnership(repoPath, files) {
  const out = [];
  for (const file of files) {
    try {
      const log = git(repoPath, [
        'log', '--follow', '--date=short',
        '--format=%ad|%an|%ae|%s', '--', file,
      ]);
      const entries = log
        ? log.split('\n').map((l) => {
            const [date, author, email, ...subj] = l.split('|');
            return { date, author, email, subject: subj.join('|') };
          })
        : [];

      if (entries.length === 0) {
        out.push({
          file,
          commitCount: 0,
          lastTouchDays: null,
          lastAuthor: null,
          authors: [],
          topAuthor: null,
          summary: 'NO HISTORY — file is untracked by git or never committed',
        });
        continue;
      }

      const authorCounts = {};
      for (const e of entries) authorCounts[e.author] = (authorCounts[e.author] || 0) + 1;
      const topAuthor = Object.entries(authorCounts).sort((a, b) => b[1] - a[1])[0][0];
      const lastTouchDays = daysSince(entries[0].date);

      out.push({
        file,
        commitCount: entries.length,
        lastTouchDays,
        lastAuthor: entries[0].author,
        lastEmail: entries[0].email,
        lastSubject: entries[0].subject,
        authors: Object.keys(authorCounts),
        topAuthor,
        summary: `${entries.length} commits · last touch ${lastTouchDays}d ago by ${entries[0].author}`,
      });
    } catch (err) {
      out.push({ file, error: String(err.message || err).slice(0, 200), summary: 'git log failed' });
    }
  }
  return out;
}

/** Whether an author has committed anything in this repo within `days`. */
export function activeAuthors(repoPath, days = 365) {
  try {
    const log = git(repoPath, ['log', `--since=${days} days ago`, '--format=%an|%ae']);
    const set = new Map();
    for (const line of log.split('\n')) {
      if (!line) continue;
      const [name, email] = line.split('|');
      set.set(email || name, name);
    }
    return [...set.entries()].map(([email, name]) => ({ name, email }));
  } catch {
    return [];
  }
}
