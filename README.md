# 🛡️ ReleaseGuard

**Release Readiness Report** for pull requests — focused on *institutional
knowledge risk*: who owns this code, do the docs still tell the truth, is it
tested, and will this change silently break someone else.

Built for the IBM Bob 2.0 Hackathon on `opencode` subagents.

## Why this is not another generic AI PR reviewer

Generic AI review tools answer "is this code correct?" — they read the diff,
find style issues, suggest a refactor. ReleaseGuard answers a harder question
nobody automates: **"if this PR ships, does anyone left on the team actually
understand what it touched?"** It fuses four evidence sources that chat-based
review cannot see — a document-understanding baseline that parses every
behavioral claim in README/comments *before* review, git archaeology of who
last touched each file and whether they still have commits, symbol-level test
coverage of the exact functions the diff changes, and call-site tracing of
breaking changes — runs them as four parallel subagents, then *aggregates*
their findings into a single knowledge-gap risk score per file. A file that is
untested, undocumented, contradicted by its own README, and last edited 18
months ago by someone who left gets escalated to a NO-GO blocker on its own —
even when no individual check would have escalated it. The output is a
release-gate verdict, not a comment thread: GO / GO_WITH_WARNINGS / NO-GO,
plus a count of knowledge gaps and auto-generated tests you can put in a
release checklist.

## One command each

```bash
# Backend (Express + node:sqlite, no native deps) → http://localhost:4000
cd backend && npm start

# Frontend (React + Vite, proxies /api → :4000) → http://localhost:5173
cd frontend && npm start

# Headless workflow: submit → 4 parallel checks → report (exit 1 = NO-GO)
node workflow/run.mjs flawed
node workflow/run.mjs clean
```

## The four checks (subagents, run in parallel)

| # | Check | Agent | Question it answers |
|---|-------|-------|---------------------|
| a | Test coverage | `rg-test-coverage` | Which touched symbols have zero test coverage? **Generates real unit tests** for the gaps and runs them. |
| b | Docs vs behavior | `rg-docs-behavior` | Does README/comment behavior still match the code the PR ships? (signature mismatches first) |
| c | Ownership & history | `rg-ownership` | Who last touched this file? Do they still have commits in the last year? Bus factor? |
| d | Breaking change | `rg-breaking-change` | Which external call sites break if this signature/type behavior changes? |

Aggregation (`backend/src/pipeline/aggregate.js`):

- any blocker → **NO-GO**; warnings only → **GO_WITH_WARNINGS**; else **GO**
- a knowledge-gap risk score ≥ 3 (untested + stale/departed owner + docs
  contradiction) escalates to a blocker even if no single check did

## Sample projects (the before/after demo)

```
sample-project/
├── flawed/            # no tests for pricing/format, README contradicts code,
│                      # pricing.js last touched 18 months ago by a departed dev
├── clean/             # tests for every module, docs match code, active owners
└── diffs/             # PR diffs fed to the pipeline
    ├── flawed-pr.diff # formatMoney returns string, applyTax rounds, GIFT5 added
    └── clean-pr.diff  # GIFT5 added with docs + test
```

Expected: `flawed` ⇒ **NO-GO** (knowledge-gap blockers), `clean` ⇒ **GO**.

```powershell
# Re-seed the git histories + PR diffs (idempotent)
powershell -NoProfile -ExecutionPolicy Bypass -File sample-project\seed-git.ps1
```

## Environment knobs

| Var | Default | Meaning |
|-----|---------|---------|
| `RG_CHECKS` | *(all four)* | Enable a subset incrementally, e.g. `RG_CHECKS=tests` |
| `RG_CHECK_TIMEOUT_MS` | `240000` | Per-agent timeout; on failure a deterministic fallback reports instead |
| `RG_STALE_DAYS` | `365` | "Stale file" threshold for ownership |
| `RG_OPENCODE_BIN` | *(auto)* | Explicit path to the `opencode` binary |

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | liveness + active check count |
| GET | `/api/presets` | the two sample reviews |
| POST | `/api/reviews` | submit `{ preset } \| { diffText } \| { repoPath, prRef }` → `{ reviewId }` |
| GET | `/api/reviews/:id` | poll status + per-check states/findings |
| GET | `/api/reviews/:id/report` | the finished Release Readiness Report |
| POST | `/api/reviews/run` | headless one-shot (submit + wait + report) |

## How a review runs

```
submit ─► ingest (diff + repo) ─► document-understanding baseline (claims/comments/tested)
       ─► git archaeology (per touched file: author, age, activity)
       ─► deterministic evidence bundle → .rg-work/<id>/evidence.json
       ─► 4 subagents IN PARALLEL (`opencode run --agent rg-*`)
       ─► verify generated tests actually execute (`node --test`)
       ─► aggregate → verdict + knowledge-gap panel → SQLite → report
```

Every agent result is normalized against the deterministic evidence; if an
agent fails or times out, the check still reports (marked *fallback*), so the
pipeline never dies.
