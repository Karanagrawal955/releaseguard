'use strict';

// Pricing module — authoritative totals for checkout.
// Last owned by the pricing team; coordinate before editing.

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
 * Apply tax to a total.
 * The tax is calculated on the order total and includes shipping
 * in the taxable base, so tax with shipping exceeds tax without.
 */
function applyTax(total, rate, shipping) {
  const base = typeof shipping === 'number' ? total : total;
  return base * rate;
}

module.exports = { calculateTotal, applyDiscount, applyTax, DISCOUNTS };
