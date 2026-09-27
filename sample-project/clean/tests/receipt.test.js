'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildReceipt } = require('../src/receipt');
const { buildInvoice } = require('../src/invoice');

const items = [{ price: 20, qty: 2 }, { price: 10, qty: 1 }];

test('buildReceipt totals with shipping taxed', () => {
  // subtotal 50, shipping 5 → base 55, tax 5.5, total 55.5
  const receipt = buildReceipt(items, { shipping: 5 });
  assert.strictEqual(typeof receipt.total, 'number');
  assert.strictEqual(receipt.total, 55.5);
  assert.strictEqual(receipt.itemCount, 2);
});

test('buildInvoice matches receipt math', () => {
  const receipt = buildReceipt(items, { shipping: 5 });
  const invoice = buildInvoice(items, { name: 'Ada', email: 'ada@example.com' }, { shipping: 5 });
  assert.strictEqual(invoice.total, receipt.total);
  assert.strictEqual(invoice.customer, 'Ada');
});

test('buildReceipt applies a discount code through the consumer branch', () => {
  // subtotal 50 -> SUMMER10 (10%) -> 45; tax on 45 + 5 shipping = 5; total 50
  const receipt = buildReceipt(items, { shipping: 5, discountCode: 'SUMMER10' });
  assert.strictEqual(receipt.subtotal, 50);
  assert.strictEqual(receipt.total, 50);
});

test('buildInvoice applies a discount code through the consumer branch', () => {
  const invoice = buildInvoice(items, { name: 'Ada', email: 'ada@example.com' }, { shipping: 5, discountCode: 'SUMMER10' });
  assert.strictEqual(invoice.total, 50);
  assert.strictEqual(invoice.subtotal, 50);
});
