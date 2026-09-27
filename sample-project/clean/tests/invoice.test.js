'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildInvoice } = require('../src/invoice');

test('buildInvoice returns customer, total and terms', () => {
  const invoice = buildInvoice([{ price: 100, qty: 1 }], { name: 'Ada', email: 'ada@example.com' });
  assert.strictEqual(invoice.customer, 'Ada');
  assert.strictEqual(invoice.dueDays, 30);
  // 100 * 1.1 = 110
  assert.strictEqual(invoice.total, 110);
});
