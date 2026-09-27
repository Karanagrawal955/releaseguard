'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateItem, validateCart } = require('../src/cart');

test('validateItem accepts a valid item', () => {
  assert.equal(validateItem({ price: 10, qty: 2 }), true);
});

test('validateItem rejects non-numeric price', () => {
  assert.throws(() => validateItem({ price: '10', qty: 2 }), TypeError);
});

test('validateItem rejects negative price', () => {
  assert.throws(() => validateItem({ price: -1, qty: 1 }), RangeError);
});

test('validateItem rejects fractional qty', () => {
  assert.throws(() => validateItem({ price: 1, qty: 1.5 }), RangeError);
});

test('validateCart accepts a valid cart', () => {
  assert.equal(validateCart([{ price: 5, qty: 1 }]), true);
});

test('validateCart rejects bad members', () => {
  assert.throws(() => validateCart([{ price: 5 }]), TypeError);
});
