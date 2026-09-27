// Aggregates the four parallel check summaries into one Release Readiness
// Report: verdict, blockers, warnings, Institutional Knowledge Gap panel, stats.

const STALE_DAYS = Number(process.env.RG_STALE_DAYS || 365);

export function aggregateReport({ reviewId, review, evidence, results, baseline }) {
  const blockers = [];
  const warnings = [];

  for (const r of results) {
    for (const f of r.findings || []) {
      const item = {
        ...f,
        check: r.check.id,
        checkName: r.check.name,
        agentMs: r.ms,
        agentUsed: r.ok !== false,
      };
      (item.severity === 'blocker' ? blockers : warnings).push(item);
    }
  }

  // Dedupe near-identical findings (same file + similar title)
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter((f) => {
      const key = `${f.file}|${f.title.toLowerCase().slice(0, 60)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const uniqBlockers = dedupe(blockers);
  const uniqWarnings = dedupe(warnings);

  // --- Institutional Knowledge Gap panel ---
  // A touched file is a knowledge gap when NOBODY currently demonstrably
  // understands it: no tests, no docs, no recent owner, or all three.
  const knowledgeGaps = buildKnowledgeGaps(evidence, uniqBlockers, uniqWarnings);

  const gapBlockers = knowledgeGaps.filter((g) => g.risk >= 3);
  // Escalate: untested + orphan touched file that the PR modifies = blocker
  for (const g of gapBlockers) {
    const already = uniqBlockers.some((b) => b.file === g.file && /owner|test|knowledge/i.test(b.title));
    if (!already && g.risk >= 3) {
      uniqBlockers.push({
        check: 'tests',
        checkName: 'Knowledge gap',
        severity: 'blocker',
        title: `Knowledge gap: nobody credibly owns ${g.file}`,
        file: g.file,
        line: null,
        detail: g.reasons.join('; '),
        evidence: g.evidence,
        agentMs: null,
        agentUsed: true,
      });
    }
  }

  // --- Verdict ---
  const verdict = uniqBlockers.length > 0 ? 'NO-GO' : uniqWarnings.length > 0 ? 'GO_WITH_WARNINGS' : 'GO';

  const testsGenerated = results
    .filter((r) => r.check.id === 'tests')
    .flatMap((r) => r.summary?.generatedTests || []);

  const totalAgentMs = results.reduce((s, r) => s + (r.ms || 0), 0);
  const wallMs = Math.max(...results.map((r) => r.ms || 0), 0);

  return {
    reviewId,
    label: review.label || review.pr_ref || review.repo_path || 'review',
    verdict,
    generatedAt: new Date().toISOString(),
    blockers: uniqBlockers,
    warnings: uniqWarnings,
    knowledgeGaps,
    generatedTests: testsGenerated,
    checks: results.map((r) => ({
      id: r.check.id,
      name: r.check.name,
      ok: r.ok !== false,
      agentError: r.agentError || null,
      ms: r.ms,
      findingCount: (r.findings || []).length,
      summary: typeof r.summary?.summary === 'string' ? r.summary.summary.slice(0, 600) : null,
    })),
    baseline: {
      docsParsed: baseline.docs.length,
      claimsExtracted: baseline.claims.length + baseline.comments.length,
      testsKnown: baseline.tested.length,
    },
    stats: {
      touchedFiles: evidence.touchedFiles.length,
      knowledgeGapCount: knowledgeGaps.length,
      blockers: uniqBlockers.length,
      warnings: uniqWarnings.length,
      testsGenerated: testsGenerated.length,
      parallelAgentMs: totalAgentMs,
      wallClockMs: wallMs,
      manualReviewMinutes: estimateManualMinutes(evidence, uniqBlockers.length, uniqWarnings.length),
      autoReviewMinutes: Math.round(wallMs / 6000) / 10, // 10x faster marker
    },
    agents: results.map((r) => ({ id: r.check.id, agent: r.check.agent, used: r.ok !== false })),
  };
}

function buildKnowledgeGaps(evidence, blockers, warnings) {
  const gaps = [];
  const testInfo = new Map(evidence.tests.touchedFiles.map((t) => [t.file, t]));
  const ownInfo = new Map(evidence.ownership.map((o) => [o.file, o]));

  // Is the file actually referenced by any doc/comment claim?
  const claimSources = new Set(
    [...(evidence.baseline?.claims || []), ...(evidence.baseline?.comments || [])].map((c) => pathBasename(c.source))
  );
  const claimText = [
    ...(evidence.baseline?.claims || []).map((c) => `${c.subject} ${c.claim}`),
    ...(evidence.baseline?.comments || []).map((c) => `${c.subject} ${c.claim}`),
  ].join('\n');
  const docMentions = new Set(evidence.baseline?.docMentions || []);
  const isDocumented = (file) => {
    const base = pathBasename(file);
    if (claimSources.has(base)) return true;
    if (claimText.includes(base)) return true;
    const stem = base.replace(/\.[^.]+$/, '');
    if (stem.length > 3 && claimText.includes(stem)) return true;
    // Any doc file that literally names this file (module maps, "see src/x.js")
    if (docMentions.has(base)) return true;
    return stem.length > 3 && docMentions.has(stem);
  };

  // Claims that map to a touched file's code
  const filesWithDocContradiction = new Set(
    [...blockers, ...warnings].filter((b) => /docs claim|contradict|mismatch/i.test(b.title)).map((b) => b.file).filter(Boolean)
  );

  for (const file of evidence.touchedFiles) {
    // Test files don't need doc references to be understood — skip them here.
    if (/(^|[\\/])tests?[\\/]|(\.test\.|\.spec\.|_test\.)/i.test(file)) continue;
    const reasons = [];
    let risk = 0;
    const t = testInfo.get(file);
    const o = ownInfo.get(file);

    if (t && t.untestedSymbols?.length && t.relatedTests?.length === 0) {
      reasons.push(`no tests cover touched symbols (${t.untestedSymbols.join(', ')})`);
      risk += 1;
    }
    if (t && t.relatedTests?.length === 0 && evidence.tests.testFileCount > 0) {
      risk += 0.5;
    }
    if (o) {
      if (o.commitCount === 0) {
        reasons.push('file has no commit history / owner');
        risk += 2;
      } else {
        if (o.lastTouchDays !== null && o.lastTouchDays > STALE_DAYS) {
          reasons.push(`last touched ${o.lastTouchDays} days ago by ${o.lastAuthor} (stale > ${STALE_DAYS}d)`);
          risk += 1.5;
        }
        const active = (evidence.contributors || []).some(
          (c) => c.email && o.lastEmail && c.email.toLowerCase() === o.lastEmail.toLowerCase()
        );
        if (o.lastTouchDays !== null && o.lastTouchDays > 90 && !active) {
          reasons.push(`last author ${o.lastAuthor} has no commits in the last year (departed?)`);
          risk += 1.5;
        }
        if ((o.authors || []).length === 1 && o.commitCount <= 2) {
          reasons.push(`single author (${o.topAuthor}) with ${o.commitCount} commit(s) — bus factor 1`);
          risk += 1;
        }
      }
    } else if (!evidence.gitAvailable) {
      reasons.push('no git history available for this repo');
    }

    if (!isDocumented(file)) {
      reasons.push('no documentation references this file');
      risk += 0.5;
    }
    if (filesWithDocContradiction.has(file)) {
      reasons.push('documentation contradicts actual behavior here');
      risk += 2;
    }

    if (reasons.length === 0) continue;

    gaps.push({
      file,
      risk: Math.round(risk * 10) / 10,
      reasons,
      lastTouchDays: o?.lastTouchDays ?? null,
      owner: o?.topAuthor ?? null,
      lastAuthor: o?.lastAuthor ?? null,
      commitCount: o?.commitCount ?? 0,
      untestedSymbols: t?.untestedSymbols || [],
      evidence: evidence.ownership.find((x) => x.file === file)?.summary || null,
    });
  }

  return gaps.sort((a, b) => b.risk - a.risk);
}

function pathBasename(p) {
  return String(p).split(/[\\/]/).pop();
}

/** Plausible manual review time for THIS diff (docs reading + ownership checks). */
function estimateManualMinutes(evidence, blockerCount, warningCount) {
  const perFile = 4; // min to read diff + trace behavior + check history/docs
  const base = 6; // setup, README skim
  return base + evidence.touchedFiles.length * perFile + blockerCount * 2 + warningCount;
}
