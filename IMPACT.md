# IMPACT — what ReleaseGuard changes about release review

*Numbers below are filled from the sample-project runs in this repo
(`node workflow/run.mjs flawed` / `clean`). Re-run them to reproduce.*

## Manual vs. automated review time

The report's `manualReviewMinutes` estimates what this diff costs a human:
read the diff, trace each touched symbol through its callers, check README
claims against behavior, run `git log` on each file to find an owner, check
their recent activity, and search for external call sites of anything with a
changed signature (4 min/file baseline + blockers/warnings).

| | Flawed sample PR | Clean sample PR |
|---|---|---|
| Estimated manual review | 32 min | 18 min |
| ReleaseGuard wall clock | 8.4 min | 2.7 min |
| Speedup | 3.8× | 6.7× |

The four checks run **in parallel**, so wall clock ≈ the slowest single agent,
not the sum of four reviews.

## Knowledge-gap risks caught (flawed sample)

Every row is a place where knowledge already left the building or never
entered it — none of which a diff-shaped reviewer would mention:

From the NO-GO report (`node workflow/run.mjs flawed` → review `8521afea`):
**8 blockers, 2 knowledge-gap files, 5 distinct knowledge-gap risk signals:**

| Risk signal | Where |
|---|---|
| Stale owner: last touched **566 days ago** (Marcus Lee) | `src/pricing.js` |
| Departed author: Marcus Lee has **0 commits in the last 365 days** | `src/pricing.js` |
| Bus factor **1**: single author, 1 commit total | `src/pricing.js` |
| Zero test coverage on touched symbols (`calculateTotal`, `applyDiscount`, `applyTax`) | `src/pricing.js` |
| Zero test coverage on touched symbol (`formatMoney`) | `src/format.js` |

The pricing.js gap scored **5.5/6** and escalated to a blocker on its own —
nobody alive on the team can review a change to the pricing math.

## Tests auto-generated

The test-coverage subagent doesn't report "no tests here" and leave. It
**writes real `node:test` files** into the work dir and the pipeline executes
them (`node --test`) — the report shows passed/failed counts, i.e. executed
proof rather than a claim.

**Flawed sample: 2 test files generated → 15 tests written, 15/15 passing**
when executed with `node --test` (verified by the pipeline, not by the agent's
claim). They cover `formatMoney`, `calculateTotal`, `applyDiscount`, `applyTax`
— the exact symbols the PR touched with zero coverage.

## The verdict

- Flawed PR → **NO-GO** (expected): the PR looks like a formatting cleanup,
  but it silently changes `formatMoney` from number → string while `receipt.js`
  does arithmetic on its return value, on a file last touched 18 months ago by
  a departed engineer with zero tests and a README that already contradicts it.
- Clean PR → **GO** (expected): same tooling, active owners, docs that match,
  tests for every touched symbol.
