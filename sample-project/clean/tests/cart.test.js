'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { validateCart } = require('../src/cart');

test('validateCart accepts a valid cart', () => {
  assert.strictEqual(validateCart([{ price: 1, qty: 2 }]), true);
});

test('validateCart rejects bad items', () => {
  assert.throws(() => validateCart('nope'), TypeError);
  assert.throws(() => validateCart([{ price: -1, qty: 1 }]), RangeError);
});
