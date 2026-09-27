# PR: currency-safe formatting + tax rounding (pr/breaking-pricing)

This is the sample PR under review. It looks like a cosmetic formatting
cleanup. It is not.

## What it changes

1. `formatMoney()` now returns `amount.toFixed(2)` — a **string** — where it
   previously returned a rounded **number**.
2. `applyTax()` rounds to whole cents.
3. Adds `GIFT5` discount code.

## Why it matters

Callers in `receipt.js` and `invoice.js` do arithmetic with `formatMoney()`
results. After this PR that arithmetic silently concatenates strings instead
of adding numbers. Nothing throws. No test fails (there are no tests for
`format.js` or `pricing.js`).
