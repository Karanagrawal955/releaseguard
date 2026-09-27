'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { calculateTotal, applyDiscount, applyTax, DISCOUNTS } = require('../src/pricing');

test('calculateTotal sums price * qty', () => {
  const total = calculateTotal([
    { price: 10, qty: 2 },
    { price: 5, qty: 1 },
  ]);
  assert.strictEqual(total, 25);
});

test('applyDiscount applies known codes and ignores unknown ones', () => {
  assert.strictEqual(applyDiscount(100, 'SUMMER10'), 90);
  assert.strictEqual(applyDiscount(100, 'NOPE'), 100);
});

test('applyTax includes shipping in the taxable base', () => {
  // (100 + 10) * 0.1 = 11 > 100 * 0.1 = 10
  assert.strictEqual(applyTax(100, 0.1, 10), 11);
  assert.strictEqual(applyTax(100, 0.1), 10);
});

test('calculateTotal rejects non-array input with TypeError', () => {
  assert.throws(() => calculateTotal('not-an-array'), TypeError);
  assert.throws(() => calculateTotal(null), TypeError);
});

test('DISCOUNTS maps every code to a whole-number percentage', () => {
  for (const [code, pct] of Object.entries(DISCOUNTS)) {
    assert.match(code, /^[A-Z0-9]+$/, `${code} should be uppercase alphanumeric`);
    assert.strictEqual(pct, Math.round(pct), `${code} percentage should be whole`);
    assert.ok(pct > 0 && pct < 100, `${code} percentage should be between 1 and 99`);
  }
  assert.strictEqual(DISCOUNTS.SUMMER10, 10);
});
