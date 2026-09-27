'use strict';

// src/cart.js — cart validation. Owned by Priya Sharma.

function validateItem(item) {
  if (!item || typeof item.price !== 'number' || typeof item.qty !== 'number') {
    throw new TypeError('item must have numeric price and qty');
  }
  if (item.price < 0) throw new RangeError('price must be >= 0');
  if (!Number.isInteger(item.qty)) throw new RangeError('qty must be an integer');
  return true;
}

function validateCart(items) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  items.forEach(validateItem);
  return true;
}

module.exports = { validateItem, validateCart };
