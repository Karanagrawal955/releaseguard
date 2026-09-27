// ReleaseGuard API server.
//   npm start   →  http://localhost:4000

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReview, getReview, listReviews } from './src/db.js';
import { runReviewPipeline, CHECKS, ACTIVE_CHECKS, submitAndRun } from './src/pipeline/runReview.js';
import { PROJECT_ROOT } from './src/pipeline/agentRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

const running = new Map(); // reviewId -> Promise

function startPipeline(id) {
  if (running.has(id)) return running.get(id);
  const p = runReviewPipeline(id)
    .catch((err) => {
      console.error(`[pipeline] ${id} failed:`, err);
    })
    .finally(() => running.delete(id));
  running.set(id, p);
  return p;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'releaseguard', checks: ACTIVE_CHECKS.length }));

// Presets for the demo (sample repos shipped with the project)
function getPresets() {
  const sample = path.join(PROJECT_ROOT, 'sample-project');
  return [
    {
      id: 'flawed',
      label: 'Flawed sample PR (expected: NO-GO)',
      repoPath: path.join(sample, 'flawed'),
      prRef: 'main..pr/breaking-pricing',
      diffPath: path.join(sample, 'diffs', 'flawed-pr.diff'),
    },
    {
      id: 'clean',
      label: 'Clean sample PR (expected: GO)',
      repoPath: path.join(sample, 'clean'),
      prRef: 'main..pr/gift5-discount',
      diffPath: path.join(sample, 'diffs', 'clean-pr.diff'),
    },
  ];
}
app.get('/api/presets', (_req, res) => res.json(getPresets()));

// Submit a review: { repoPath, prRef } | { diffText } | { preset }
app.post('/api/reviews', async (req, res) => {
  try {
    const { repoPath, prRef, diffText, label, preset } = req.body || {};
    let resolved = { repoPath, prRef, diffText, label };

    if (preset) {
      const p = getPresets().find((x) => x.id === preset);
      if (!p) return res.status(400).json({ error: `Unknown preset ${preset}` });
      // Prefer explicit diff file so PR review works without branch refs
      let diff = null;
      if (p.diffPath) {
        const fs = await import('node:fs');
        try {
          diff = fs.readFileSync(p.diffPath, 'utf8');
        } catch { /* fall through to git ref */ }
      }
      resolved = { repoPath: p.repoPath, prRef: diff ? null : p.prRef, diffText: diff, label: p.label };
    }

    if (!resolved.diffText && !(resolved.repoPath && resolved.prRef)) {
      return res.status(400).json({ error: 'Provide diffText, or repoPath+prRef, or preset' });
    }

    const id = (await import('node:crypto')).randomUUID().slice(0, 8);
    createReview({
      id,
      repoPath: resolved.repoPath || null,
      prRef: resolved.prRef || null,
      diffText: resolved.diffText || null,
      label: resolved.label || null,
    });
    startPipeline(id);
    res.status(201).json({ reviewId: id, status: 'queued' });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/reviews', (_req, res) => res.json(listReviews()));

app.get('/api/reviews/:id', (req, res) => {
  const r = getReview(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({
    id: r.id,
    status: r.status,
    label: r.label,
    prRef: r.pr_ref,
    repoPath: r.repo_path,
    error: r.error,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    checks: r.checks.map((c) => ({
      id: c.check_id,
      name: c.name,
      state: c.state,
      summary: c.summary,
      ms: c.ms,
      error: c.error,
      findings: c.findings,
      updatedAt: c.updated_at,
    })),
  });
});

app.get('/api/reviews/:id/report', (req, res) => {
  const r = getReview(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  if (!r.report) return res.status(409).json({ error: 'report not ready', status: r.status });
  res.json(r.report);
});

// Headless one-shot (used by the WORKFLOW): submit + wait + return report
app.post('/api/reviews/run', async (req, res) => {
  try {
    const { repoPath, prRef, diffText, label, preset } = req.body || {};
    let resolved = { repoPath, prRef, diffText, label };

    if (preset) {
      const p = getPresets().find((x) => x.id === preset);
      if (!p) return res.status(400).json({ error: `Unknown preset ${preset}` });
      let diff = null;
      if (p.diffPath) {
        const fs = await import('node:fs');
        try { diff = fs.readFileSync(p.diffPath, 'utf8'); } catch { /* fall through */ }
      }
      resolved = { repoPath: p.repoPath, prRef: diff ? null : p.prRef, diffText: diff, label: p.label };
    }

    if (!resolved.diffText && !(resolved.repoPath && resolved.prRef)) {
      return res.status(400).json({ error: 'Provide diffText, repoPath+prRef, or preset' });
    }
    const { id, report } = await submitAndRun(resolved);
    res.json({ reviewId: id, report });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`ReleaseGuard backend listening on http://localhost:${PORT}`);
  console.log(`Checks: ${CHECKS.map((c) => c.id).join(', ')}`);
});
