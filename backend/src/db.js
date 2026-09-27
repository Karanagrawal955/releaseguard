// SQLite persistence layer using Node's built-in node:sqlite (zero native deps).
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.RG_DB_PATH || path.join(__dirname, '..', 'releaseguard.db');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS reviews (
    id          TEXT PRIMARY KEY,
    repo_path   TEXT,
    pr_ref      TEXT,
    diff_text   TEXT,
    label       TEXT,
    status      TEXT NOT NULL DEFAULT 'queued',
    error       TEXT,
    report_json TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS checks (
    review_id   TEXT NOT NULL,
    check_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    state       TEXT NOT NULL DEFAULT 'pending',
    summary     TEXT,
    findings_json TEXT,
    ms          INTEGER,
    error       TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (review_id, check_id),
    FOREIGN KEY (review_id) REFERENCES reviews(id)
  );
`);

export function createReview({ id, repoPath = null, prRef = null, diffText = null, label = null }) {
  db.prepare(
    `INSERT INTO reviews (id, repo_path, pr_ref, diff_text, label, status) VALUES (?, ?, ?, ?, ?, 'queued')`
  ).run(id, repoPath, prRef, diffText, label);
}

export function setReviewStatus(id, status, { error = null } = {}) {
  db.prepare(
    `UPDATE reviews SET status = ?, error = ?,
       finished_at = CASE WHEN ? IN ('done','failed') THEN datetime('now') ELSE finished_at END
     WHERE id = ?`
  ).run(status, error, status, id);
}

export function saveReport(id, report) {
  db.prepare(`UPDATE reviews SET report_json = ? WHERE id = ?`).run(JSON.stringify(report), id);
}

export function getReview(id) {
  const row = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    ...row,
    report: row.report_json ? JSON.parse(row.report_json) : null,
    checks: db
      .prepare(`SELECT * FROM checks WHERE review_id = ? ORDER BY check_id`)
      .all(id)
      .map((c) => ({ ...c, findings: c.findings_json ? JSON.parse(c.findings_json) : null })),
  };
}

export function listReviews() {
  return db
    .prepare(
      `SELECT id, repo_path, pr_ref, label, status, created_at, finished_at FROM reviews ORDER BY created_at DESC LIMIT 50`
    )
    .all();
}

export function initCheck(reviewId, checkId, name) {
  db.prepare(
    `INSERT OR REPLACE INTO checks (review_id, check_id, name, state, updated_at) VALUES (?, ?, ?, 'running', datetime('now'))`
  ).run(reviewId, checkId, name);
}

export function finishCheck(reviewId, checkId, { state, summary = null, findings = null, ms = null, error = null }) {
  db.prepare(
    `UPDATE checks SET state = ?, summary = ?, findings_json = ?, ms = ?, error = ?, updated_at = datetime('now')
     WHERE review_id = ? AND check_id = ?`
  ).run(state, summary, findings ? JSON.stringify(findings) : null, ms, error, reviewId, checkId);
}
