'use strict';

// src/pricing.js — pricing math. Owned by the payments team.

const DISCOUNTS = {
  SUMMER10: 10,
  WELCOME5: 5,
  FRIEND20: 20,
};

/**
 * Calculate the item subtotal.
 */
function calculateTotal(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

/**
 * Apply a percentage discount code. Unknown codes are ignored.
 */
function applyDiscount(total, code) {
  const pct = DISCOUNTS[code];
  if (!pct) return total;
  return total * (1 - pct / 100);
}

/**
 * Apply tax to a total. Shipping is part of the taxable base,
 * so tax is computed on (total + shipping).
 */
function applyTax(total, rate, shipping) {
  const base = total + (shipping || 0);
  return base * rate;
}

module.exports = { calculateTotal, applyDiscount, applyTax, DISCOUNTS };
