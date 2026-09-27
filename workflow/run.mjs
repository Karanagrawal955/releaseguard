#!/usr/bin/env node
// ReleaseGuard WORKFLOW — the repeatable submit → checks → report loop.
//   node workflow/run.mjs [flawed|clean] [--checks tests,docs] [--watch]
//
// It is deliberately built on the same primitives the UI uses, but headless:
//   1. POST /api/reviews/run (or submit + poll)  → backend runs the 4
//      subagents in parallel and returns a Release Readiness Report.
//   2. The report is printed as a stable, diffable text block, so re-running
//      after adding one more check is a one-line change, not a rebuild.

const BASE = process.env.RG_API || 'http://localhost:4000';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const preset = process.argv.slice(2).find((a) => !a.startsWith('-') && a !== 'run.mjs');
const checks = arg('--checks', process.env.RG_CHECKS || '');

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

// Submit, then poll: a single long-lived request dies on proxy/fetch
// timeouts while 4 agents chew on a big diff. Polling also gives progress.
async function runReview(payload) {
  const { reviewId } = await post('/api/reviews', payload);
  const started = Date.now();
  const seen = new Set();
  for (;;) {
    const res = await fetch(`${BASE}/api/reviews/${reviewId}`);
    if (!res.ok) throw new Error(`poll failed: ${res.status}`);
    const review = await res.json();
    for (const c of review.checks || []) {
      if (c.state !== 'pending' && !seen.has(`${c.id}:${c.state}`)) {
        seen.add(`${c.id}:${c.state}`);
        console.log(`  [${((Date.now() - started) / 1000).toFixed(0)}s] ${c.name} → ${c.state}`);
      }
    }
    if (review.status === 'done') {
      const report = await fetch(`${BASE}/api/reviews/${reviewId}/report`).then((r) => r.json());
      return { reviewId, report };
    }
    if (review.status === 'failed') throw new Error(`review ${reviewId} failed: ${review.error || 'unknown'}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

function bar(n, width = 20) {
  return '█'.repeat(Math.min(n, width)) + '░'.repeat(Math.max(width - n, 0));
}

function printReport(report) {
  const s = report.stats || {};
  const line = '─'.repeat(78);
  console.log(line);
  console.log(` RELEASE READINESS REPORT  ·  ${report.label}  ·  ${report.verdict}`);
  console.log(line);
  console.log(` generated: ${report.generatedAt}`);
  console.log(
    ` blockers: ${s.blockers}   warnings: ${s.warnings}   knowledge gaps: ${s.knowledgeGapCount}   tests generated: ${s.testsGenerated}`
  );
  console.log(
    ` manual review ≈ ${s.manualReviewMinutes} min   auto ≈ ${s.autoReviewMinutes} min   wall clock ${(s.wallClockMs / 1000).toFixed(1)}s`
  );

  if (report.knowledgeGaps?.length) {
    console.log('\n INSTITUTIONAL KNOWLEDGE GAPS');
    for (const g of report.knowledgeGaps) {
      const flag = g.risk >= 3 ? '!!' : '  ';
      console.log(` ${flag} [risk ${g.risk}] ${g.file}  (owner: ${g.owner || 'none'}, last touch: ${g.lastTouchDays ?? '?'}d)`);
      for (const r of g.reasons) console.log(`        - ${r}`);
    }
  }

  const printFindings = (title, items) => {
    if (!items?.length) return;
    console.log(`\n ${title.toUpperCase()} (${items.length})`);
    for (const f of items) {
      console.log(`   • [${f.checkName || f.check}] ${f.title}`);
      if (f.file) console.log(`       at ${f.file}${f.line ? `:${f.line}` : ''}`);
      if (f.detail) console.log(`       ${f.detail.slice(0, 300)}`);
    }
  };
  printFindings('blockers', report.blockers);
  printFindings('warnings', report.warnings);

  console.log('\n SUBAGENTS');
  for (const c of report.checks || []) {
    const mode = c.ok ? 'agent    ' : 'fallback ';
    console.log(`   ${mode} ${c.name.padEnd(20)} ${String(c.findingCount).padStart(2)} finding(s)  ${(c.ms / 1000).toFixed(1)}s`);
    if (c.summary) console.log(`             ${c.summary.slice(0, 160)}`);
  }

  if (report.generatedTestVerification) {
    const v = report.generatedTestVerification;
    console.log(`\n GENERATED TESTS: ${v.passed} passed, ${v.failed} failed in ${(v.ms / 1000).toFixed(1)}s (executed, not claimed)`);
  }
  console.log(line);
}

async function main() {
  if (checks) console.log(`[workflow] RG_CHECKS=${checks}`);
  if (checks && process.env.RG_CHECKS !== checks) {
    console.log('[workflow] NOTE: checks are fixed at backend start time.');
    console.log(`           Restart the backend with RG_CHECKS=${checks} for this run.`);
  }

  const target = { preset: preset === 'clean' ? 'clean' : 'flawed' };
  console.log(`[workflow] submitting preset "${target.preset}" → ${BASE}/api/reviews`);
  const started = Date.now();
  const { reviewId, report } = await runReview(target);
  console.log(`[workflow] review ${reviewId} finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!report) {
    console.error('[workflow] no report returned');
    process.exit(2);
  }
  printReport(report);
  // Exit code encodes the verdict — usable in CI.
  process.exit(report.verdict === 'NO-GO' ? 1 : 0);
}

main().catch((err) => {
  console.error(`[workflow] failed: ${err.message}`);
  console.error('          Is the backend running?  cd backend && npm start');
  process.exit(2);
});
