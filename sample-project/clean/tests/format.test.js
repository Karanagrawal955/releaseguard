'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { formatMoney } = require('../src/format');

test('formatMoney rounds to two decimals and returns a number', () => {
  const out = formatMoney(12.346);
  assert.strictEqual(typeof out, 'number');
  assert.strictEqual(out, 12.35);
});

test('formatMoney rejects non-numbers', () => {
  assert.throws(() => formatMoney('12'), TypeError);
  assert.throws(() => formatMoney(NaN), TypeError);
});
