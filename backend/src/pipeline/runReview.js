// Review orchestrator: ingest → build baseline → launch 4 subagents in
// parallel → aggregate → verdict → persist. This is the unit the WORKFLOW
// invokes, so re-running on a new PR never rebuilds anything.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReview, setReviewStatus, saveReport, initCheck, finishCheck, getReview } from '../db.js';
import { parseUnifiedDiff, buildDiffContext, gitDiff } from '../ingest/diff.js';
import { buildBaseline } from '../ingest/baseline.js';
import { fileOwnership, activeAuthors, isGitRepo } from '../ingest/git.js';
import { runCheckAgent, PROJECT_ROOT } from './agentRunner.js';
import {
  testCoverageEvidence,
  docsBehaviorEvidence,
  breakingChangeEvidence,
  extractChangedSymbols,
} from './evidence.js';
import { aggregateReport } from './aggregate.js';

export const CHECKS = [
  { id: 'tests', name: 'Test coverage', agent: 'rg-test-coverage' },
  { id: 'docs', name: 'Docs vs behavior', agent: 'rg-docs-behavior' },
  { id: 'ownership', name: 'Ownership & history', agent: 'rg-ownership' },
  { id: 'breaking', name: 'Breaking changes', agent: 'rg-breaking-change' },
];

// Incremental wiring: RG_CHECKS=tests  → only that check runs.
// Unset → all four run in parallel (the production path).
const enabledFilter = (process.env.RG_CHECKS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const ACTIVE_CHECKS = enabledFilter.length
  ? CHECKS.filter((c) => enabledFilter.includes(c.id))
  : CHECKS;

function workDirFor(reviewId, checkId) {
  return path.join(PROJECT_ROOT, '.rg-work', reviewId, checkId);
}

/** Resolve the diff + repo context from a review record. */
function resolveInput(review) {
  let diffText = review.diff_text;
  const repoPath = review.repo_path ? path.resolve(review.repo_path) : null;

  if (!diffText && repoPath && review.pr_ref) {
    diffText = gitDiff(repoPath, review.pr_ref);
  }
  if (!diffText) throw new Error('Review needs diffText or repoPath+prRef');

  const parsed = parseUnifiedDiff(diffText);
  const diffContext = buildDiffContext(parsed);
  if (diffContext.length === 0) throw new Error('No changed files found in diff');
  return { diffText, repoPath, diffContext };
}

/** Run the full pipeline for a review (async; caller polls status). */
export async function runReviewPipeline(reviewId) {
  const review = getReview(reviewId);
  if (!review) throw new Error(`Unknown review ${reviewId}`);
  setReviewStatus(reviewId, 'ingesting');

  let ctx;
  try {
    ctx = resolveInput(review);
  } catch (err) {
    setReviewStatus(reviewId, 'failed', { error: String(err.message || err) });
    return;
  }

    const repoPath = ctx.repoPath || path.join(PROJECT_ROOT, 'sample-project', 'flawed');
  const gitAvailable = isGitRepo(repoPath);

  // --- Document Understanding: claimed-behavior baseline ---
  const baseline = buildBaseline(repoPath);

  // --- Git archaeology for touched files ---
  const touchedPaths = ctx.diffContext.map((d) => d.path);
  const ownership = gitAvailable ? fileOwnership(repoPath, touchedPaths) : [];
  const contributors = gitAvailable ? activeAuthors(repoPath, 365) : [];

  // --- Deterministic evidence per check ---
  const evidence = {
    repoPath,
    gitAvailable,
    touchedFiles: touchedPaths,
    diff: ctx.diffContext,
    baseline: {
      docs: baseline.docs,
      claims: baseline.claims,
      comments: baseline.comments,
      docMentions: baseline.docMentions,
      tested: baseline.tested.slice(0, 200),
    },
    ownership,
    contributors,
    tests: testCoverageEvidence({ repoPath, diffContext: ctx.diffContext, baseline }),
    docs: docsBehaviorEvidence({ repoPath, diffContext: ctx.diffContext, baseline }),
    breaking: breakingChangeEvidence({ repoPath, diffContext: ctx.diffContext, baseline }),
    changedSymbols: extractChangedSymbols(ctx.diffContext),
  };

  // Persist raw diff + evidence for agents to read
  const reviewWorkDir = path.join(PROJECT_ROOT, '.rg-work', reviewId);
  fs.mkdirSync(reviewWorkDir, { recursive: true });
  fs.writeFileSync(path.join(reviewWorkDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(reviewWorkDir, 'diff.patch'), ctx.diffText);

  // --- Launch the enabled subagents IN PARALLEL ---
  setReviewStatus(reviewId, 'running');
  const sharedPrompt = buildSharedPrompt(reviewId, reviewWorkDir, evidence);

  const results = await Promise.all(
    ACTIVE_CHECKS.map(async (check) => {
      initCheck(reviewId, check.id, check.name);
      const started = Date.now();
      const dir = workDirFor(reviewId, check.id);
      try {
        const res = await runCheckAgent({
          agentId: check.agent,
          reviewId,
          workDir: dir,
          message: `${sharedPrompt}\n\nYOUR CHECK: ${check.name} (id: ${check.id}). Do only this check. Write ONLY your summary JSON to ${path.join(dir, 'summary.json').replace(/\\/g, '/')}.`,
          files: [path.join(reviewWorkDir, 'evidence.json')],
        });
        const ms = Date.now() - started;
        if (res.ok || res.summary) {
          const findings = normalizeFindings(res.summary, check.id);
          finishCheck(reviewId, check.id, {
            state: findings.some((f) => f.severity === 'blocker') ? 'blockers' : findings.length ? 'warnings' : 'clear',
            summary: typeof res.summary.summary === 'string' ? res.summary.summary.slice(0, 600) : `${findings.length} finding(s)`,
            findings,
            ms,
            error: res.error || null,
          });
          return { check, findings, summary: res.summary, ms, ok: res.ok !== false };
        }
        // Fallback: deterministic-only result so the pipeline never dies
        const fallback = deterministicFallback(check.id, evidence);
        finishCheck(reviewId, check.id, {
          state: fallback.findings.some((f) => f.severity === 'blocker') ? 'blockers' : fallback.findings.length ? 'warnings' : 'clear',
          summary: `agent unavailable — ${fallback.findings.length} deterministic finding(s) (${String(res.error || '').slice(0, 120)})`,
          findings: fallback.findings,
          ms,
          error: String(res.error || 'agent failed'),
        });
        return { check, findings: fallback.findings, summary: { summary: fallback.summary }, ms, ok: false, agentError: res.error };
      } catch (err) {
        const ms = Date.now() - started;
        finishCheck(reviewId, check.id, { state: 'error', error: String(err.message || err), ms });
        return { check, findings: [], summary: null, ms, ok: false, agentError: String(err.message || err) };
      }
    })
  );

  // --- Verify generated tests actually run (proof, not claims) ---
  const testsWorkDir = workDirFor(reviewId, 'tests');
  const verification = await verifyGeneratedTests(testsWorkDir);

  // --- Aggregate into the Release Readiness Report ---
  setReviewStatus(reviewId, 'aggregating');
  const report = aggregateReport({ reviewId, review, evidence, results, baseline });
  if (verification) report.generatedTestVerification = verification;
  saveReport(reviewId, report);
  setReviewStatus(reviewId, 'done');
  return report;
}

/**
 * Execute any tests the test-coverage subagent generated.
 * @returns {null | {total, passed, failed, ms, output}}
 */
async function verifyGeneratedTests(workDir) {
  const dir = path.join(workDir, 'generated-tests');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js') || f.endsWith('.test.mjs'));
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  const started = Date.now();
  const { execFileSync } = await import('node:child_process');
  let output = '';
  let ok = true;
  try {
    output = execFileSync(process.execPath, ['--test', ...files.map((f) => path.join(dir, f))], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    ok = false;
    output = `${err.stdout || ''}\n${err.stderr || ''}`;
  }
  // `node --test` prints TAP (`# pass 15`) in some runners and the spec
  // reporter (`ℹ pass 15`, possibly ANSI-colored) in others — match both.
  const stripAnsi = output.replace(/\u001b\[[0-9;]*m/g, '');
  const passed = /(?:^|\s)(?:#|\u2139)\s*pass\s+(\d+)/m.exec(stripAnsi)?.[1];
  const failed = /(?:^|\s)(?:#|\u2139)\s*fail\s+(\d+)/m.exec(stripAnsi)?.[1];
  return {
    files: files.length,
    passed: passed != null ? Number(passed) : null,
    failed: failed != null ? Number(failed) : null,
    ok,
    ms: Date.now() - started,
    output: output.slice(-2000),
  };
}

function buildSharedPrompt(reviewId, workDir, evidence) {
  const wd = workDir.replace(/\\/g, '/');
  return `You are a ReleaseGuard review subagent. Review ID: ${reviewId}.
Evidence bundle: ${wd}/evidence.json (already attached). Diff: ${wd}/diff.patch.
Repo root: ${evidence.repoPath} (read files with absolute paths from repo root).

You must return a SHORT summary JSON only (<= 1KB of prose total) with this exact shape:
{
  "check": "<your check id>",
  "state": "clear" | "warnings" | "blockers",
  "summary": "one or two sentences",
  "findings": [
    { "severity": "blocker" | "warning", "title": "...", "file": "path", "line": 12,
      "detail": "...", "evidence": "quote or concrete fact" }
  ],
  "metrics": { }
}
Rules: findings must cite concrete evidence from evidence.json or files you read.
Do not paste file contents or long transcripts. Write the JSON file first, then reply with the same JSON.`;
}

/** Force agent output into our finding schema. */
function normalizeFindings(summary, checkId) {
  const findings = Array.isArray(summary?.findings) ? summary.findings : [];
  return findings.slice(0, 12).map((f) => ({
    check: checkId,
    severity: f.severity === 'blocker' ? 'blocker' : 'warning',
    title: String(f.title || 'Finding').slice(0, 200),
    file: f.file ? String(f.file) : null,
    line: Number.isFinite(f.line) ? f.line : null,
    detail: String(f.detail || '').slice(0, 1200),
    evidence: f.evidence ? String(f.evidence).slice(0, 600) : null,
  }));
}

/** Deterministic fallback when the agent subprocess fails. */
function deterministicFallback(checkId, evidence) {
  const findings = [];
  switch (checkId) {
    case 'tests': {
      for (const f of evidence.tests.touchedFiles) {
        if (f.untestedSymbols.length && f.relatedTests.length === 0) {
          findings.push({
            severity: 'blocker',
            title: `No tests cover ${f.file}`,
            file: f.file,
            detail: `Touched symbols with zero test references: ${f.untestedSymbols.join(', ')}. No related test file found.`,
            evidence: `testFiles in repo: ${evidence.tests.testFileCount}`,
          });
        } else if (f.untestedSymbols.length) {
          findings.push({
            severity: 'warning',
            title: `Untested symbols in ${f.file}`,
            file: f.file,
            detail: `Not referenced by any test: ${f.untestedSymbols.join(', ')}`,
            evidence: null,
          });
        }
      }
      break;
    }
    case 'docs': {
      for (const c of evidence.docs.relevantClaims) {
        findings.push({
          severity: 'blocker',
          title: `Docs claim may not match code: ${c.subject}`,
          file: c.codeSnippet?.file || c.source,
          line: c.codeSnippet?.line || c.line,
          detail: `README/docs says: "${c.claim}" (${c.source}:${c.line}) — verify against actual code.`,
          evidence: c.codeSnippet?.snippet?.slice(0, 300) || null,
        });
      }
      break;
    }
    case 'ownership': {
      for (const o of evidence.ownership) {
        if (o.commitCount === 0 || o.lastTouchDays === null) {
          findings.push({ severity: 'blocker', title: `No owner: ${o.file}`, file: o.file, detail: o.summary, evidence: null });
        } else if (o.lastTouchDays > 365) {
          findings.push({ severity: 'warning', title: `Stale: ${o.file}`, file: o.file, detail: o.summary, evidence: null });
        }
      }
      break;
    }
    case 'breaking': {
      for (const c of evidence.breaking.externalCallSites) {
        findings.push({
          severity: 'blocker',
          title: `Signature change affects ${c.sites.length} external call site(s) of ${c.symbol}`,
          file: c.changedIn,
          detail: c.sites.map((s) => `${s.file}:${s.line}`).join(', '),
          evidence: c.sites[0]?.code || null,
        });
      }
      break;
    }
  }
  return {
    findings: findings.slice(0, 12),
    summary: `${findings.length} deterministic finding(s) (agent offline)`,
  };
}

/** Convenience: create + run a review in one call (used by workflow CLI). */
export async function submitAndRun({ repoPath, prRef, diffText, label }) {
  const id = crypto.randomUUID().slice(0, 8);
  createReview({ id, repoPath, prRef, diffText, label });
  const report = await runReviewPipeline(id);
  return { id, report };
}
