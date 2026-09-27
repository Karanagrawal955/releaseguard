# 🛡️ ReleaseGuard

**Release Readiness Report — a release gate for *institutional knowledge risk***

*IBM Bob 2.0 Hackathon*

---

### The question it answers

Generic AI PR reviewers ask *"is this code correct?"*.
ReleaseGuard asks the question nobody automates:

> **"If this PR ships, does anyone left on the team actually understand what it touched?"**

---

### What it does

Submit a repo path or diff → four **IBM Bob subagents run in parallel** → one release verdict.

| # | Subagent | Question it answers |
|---|----------|---------------------|
| a | **Test coverage** | Which touched symbols have zero tests? — and it **writes real unit tests** for the gaps, then the pipeline executes them (`node --test`) |
| b | **Docs vs behavior** | Does README/comment still tell the truth about the code the PR ships? (signature mismatches first) |
| c | **Ownership & history** | Who last touched this file? Do they still have commits? Bus factor? |
| d | **Breaking change** | Which external call sites break if this behavior changes? |

Findings aggregate into **GO / GO_WITH_WARNINGS / NO-GO** plus a per-file
**knowledge-gap risk score**. Untested + stale/departed owner + docs
contradiction escalates to a blocker on its own — even when no single
check would have raised it.

---

### Demo results (reproducible: `node workflow/run.mjs flawed | clean`)

| | Flawed sample PR | Clean sample PR |
|---|---|---|
| Verdict | **NO-GO** — 6–8 blockers | **GO** — 0 blockers, 0 warnings, 0 gaps |
| Knowledge gaps | `pricing.js` **5.5/6** (566d stale, departed author, bus factor 1, zero tests) + `format.js` 3.5 | 0 |
| Caught silently | `"cosmetic"` diff turns `formatMoney` number → string; invoice math becomes string concatenation | purely additive, all symbols tested |
| Tests auto-generated | **15 written, 15/15 passing** (executed, not claimed) | none needed |
| Review time | 28–32 min manual → **~9 min auto (3.8×)** | 18 min manual → **~3 min auto (6×)** |

---

### Architecture

```
submit ─► ingest (diff + repo) ─► document-understanding baseline (claims/comments/tested)
       ─► git archaeology (owner, age, activity per touched file)
       ─► deterministic evidence bundle ─► 4 Bob subagents IN PARALLEL
       ─► verify generated tests actually execute (node --test)
       ─► aggregate → verdict + knowledge-gap panel → SQLite → React report
```

- **Backend:** Express + `node:sqlite` (no native deps) — one command
- **Frontend:** React + Vite, live per-check status cards — one command
- **Workflow CLI:** `node workflow/run.mjs flawed` — exit 1 on NO-GO (CI-ready)
- **Resilient:** agent fails or times out → deterministic fallback still reports; the pipeline never dies

---

### Stack

React · Vite · Express · node:sqlite · Node.js · **IBM Bob subagents (opencode)** · node:test

**Repo:** https://github.com/Karanagrawal955/releaseguard

*Built end-to-end with IBM Bob — Bob powers both the product and its development. No watsonx.ai/Orchestrate usage.*
