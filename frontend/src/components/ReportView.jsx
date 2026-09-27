import React from 'react';

// Step 3 — the Release Readiness Report.
export default function ReportView({ report, onReset }) {
  const verdict = report.verdict;
  const stats = report.stats || {};
  const checks = report.checks || [];
  const verification = report.generatedTestVerification;

  return (
    <div>
      <div className={`verdict verdict-${verdict}`}>
        <div>
          <h2>{verdict.replace(/_/g, ' ')}</h2>
          <p>
            {report.label} · generated {new Date(report.generatedAt).toLocaleTimeString()}
          </p>
        </div>
        <div className="verdict-stats">
          <Stat n={stats.blockers} label="blockers" tone={stats.blockers ? 'bad' : 'good'} />
          <Stat n={stats.warnings} label="warnings" tone={stats.warnings ? 'warn' : 'good'} />
          <Stat n={stats.knowledgeGapCount} label="knowledge gaps" tone="warn" />
          <Stat n={stats.testsGenerated} label="tests generated" tone="good" />
        </div>
      </div>

      {/* --- Institutional Knowledge Gap panel (the point of ReleaseGuard) --- */}
      <div className="card">
        <h3>Institutional knowledge gaps</h3>
        {report.knowledgeGaps?.length ? (
          <table className="gaps">
            <thead>
              <tr>
                <th>File</th>
                <th>Risk</th>
                <th>Owner</th>
                <th>Why nobody here understands this code</th>
              </tr>
            </thead>
            <tbody>
              {report.knowledgeGaps.map((g) => (
                <tr key={g.file} className={g.risk >= 3 ? 'gap-high' : ''}>
                  <td className="mono">{g.file}</td>
                  <td>
                    <span className={`risk risk-${g.risk >= 3 ? 'high' : 'low'}`}>{g.risk}</span>
                  </td>
                  <td>
                    {g.owner || '—'}
                    {g.lastTouchDays != null && (
                      <small className="muted"> · last touch {g.lastTouchDays}d ago</small>
                    )}
                  </td>
                  <td>
                    <ul>
                      {g.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No touched file is an island — every file has tests, docs and a recent owner.</p>
        )}
      </div>

      {/* --- Findings --- */}
      <Findings title="Blockers" items={report.blockers} severity="blocker" />
      <Findings title="Warnings" items={report.warnings} severity="warning" />

      {/* --- Check summaries --- */}
      <div className="card">
        <h3>What each subagent found</h3>
        <div className="check-summaries">
          {checks.map((c) => (
            <div key={c.id} className={`summary-box ${c.ok ? '' : 'fallback'}`}>
              <strong>{c.name}</strong>{' '}
              <span className={`badge badge-${c.ok ? 'ok' : 'warn'}`}>
                {c.ok ? 'subagent' : 'deterministic fallback'}
              </span>
              <p>{c.summary || `${c.findingCount} finding(s)`}</p>
              <small className="muted">{(c.ms / 1000).toFixed(1)}s</small>
            </div>
          ))}
        </div>
      </div>

      {/* --- Generated tests (proof, not claims) --- */}
      <div className="card">
        <h3>Auto-generated tests</h3>
        {report.generatedTests?.length ? (
          <>
            <ul>
              {report.generatedTests.map((t, i) => (
                <li key={i} className="mono">{t}</li>
              ))}
            </ul>
            {verification ? (
              <p className={verification.ok ? 'ok-text' : 'error'}>
                Verified by execution: {verification.passed}/{verification.passed + verification.failed}{' '}
                passed in {(verification.ms / 1000).toFixed(1)}s
              </p>
            ) : (
              <p className="muted">Written but not executed (no runner available).</p>
            )}
          </>
        ) : (
          <p className="muted">No tests were needed for this diff — all touched symbols already have coverage.</p>
        )}
      </div>

      {/* --- Timing / impact --- */}
      <div className="card">
        <h3>Impact</h3>
        <div className="impact-grid">
          <div>
            <b>{stats.manualReviewMinutes} min</b>
            <span>manual review estimate</span>
          </div>
          <div>
            <b>{stats.autoReviewMinutes} min</b>
            <span>ReleaseGuard wall clock</span>
          </div>
          <div>
            <b>{stats.touchedFiles}</b>
            <span>files touched</span>
          </div>
          <div>
            <b>{report.baseline?.claimsExtracted ?? 0}</b>
            <span>doc claims extracted &amp; verified</span>
          </div>
        </div>
      </div>

      <button className="primary" onClick={onReset}>
        Run another review
      </button>
    </div>
  );
}

function Stat({ n, label, tone }) {
  return (
    <div className={`stat stat-${tone}`}>
      <b>{n ?? 0}</b>
      <span>{label}</span>
    </div>
  );
}

function Findings({ title, items, severity }) {
  if (!items?.length) return null;
  return (
    <div className="card">
      <h3>
        {title} <span className="count">{items.length}</span>
      </h3>
      {items.map((f, i) => (
        <div key={i} className={`finding finding-${severity}`}>
          <div className="finding-head">
            <span className={`sev sev-${severity}`}>{severity}</span>
            <strong>{f.title}</strong>
          </div>
          {f.file && (
            <div className="mono finding-loc">
              {f.file}
              {f.line ? `:${f.line}` : ''} <span className="muted">({f.checkName || f.check})</span>
            </div>
          )}
          {f.detail && <p>{f.detail}</p>}
          {f.evidence && <pre className="evidence">{f.evidence}</pre>}
        </div>
      ))}
    </div>
  );
}
