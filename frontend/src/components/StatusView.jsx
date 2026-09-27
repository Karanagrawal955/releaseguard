import React from 'react';

const CHECK_ORDER = ['tests', 'docs', 'ownership', 'breaking'];

const STATE_LABEL = {
  pending: 'queued',
  running: 'running…',
  clear: 'clear',
  warnings: 'warnings',
  blockers: 'blockers',
  error: 'error',
};

// Step 2 — live status: the four checks render as parallel cards.
export default function StatusView({ review }) {
  const checks = [...(review.checks || [])].sort(
    (a, b) => CHECK_ORDER.indexOf(a.id) - CHECK_ORDER.indexOf(b.id)
  );
  const status = review.status;

  return (
    <div className="card">
      <div className="status-head">
        <h2>{review.label || review.id}</h2>
        <span className={`pill status-${status}`}>{status}</span>
      </div>
      <p className="muted">Review {review.id} · spawning 4 subagents in parallel</p>

      <div className="check-grid">
        {checks.map((c) => (
          <div key={c.id} className={`check-card state-${c.state}`}>
            <div className="check-top">
              <span className="check-name">{c.name}</span>
              <span className={`badge badge-${c.state}`}>{STATE_LABEL[c.state] || c.state}</span>
            </div>
            {c.state === 'running' && <div className="spinner" />}
            {c.summary && <p className="check-summary">{c.summary}</p>}
            {c.error && <p className="error">{String(c.error).slice(0, 200)}</p>}
            {c.ms != null && <small className="muted">{(c.ms / 1000).toFixed(1)}s</small>}
            {c.findings?.length > 0 && (
              <ul className="mini-findings">
                {c.findings.slice(0, 4).map((f, i) => (
                  <li key={i} className={f.severity}>
                    {f.title}
                  </li>
                ))}
                {c.findings.length > 4 && <li className="muted">+{c.findings.length - 4} more…</li>}
              </ul>
            )}
          </div>
        ))}
      </div>

      {review.error && <p className="error">{review.error}</p>}
    </div>
  );
}
