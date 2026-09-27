'use strict';

// src/receipt.js — receipt assembly. Owned by Priya Sharma.

const { calculateTotal, applyDiscount, applyTax } = require('./pricing');
const { formatMoney } = require('./format');
const { validateCart } = require('./cart');

/**
 * Build a receipt for a cart. Applies discount (if any), then tax
 * (shipping included in the taxable base), then rounds via formatMoney.
 */
function buildReceipt(items, { shipping = 0, taxRate = 0.1, discountCode } = {}) {
  validateCart(items);
  const subtotal = calculateTotal(items);
  const discounted = discountCode ? applyDiscount(subtotal, discountCode) : subtotal;
  const total = applyTax(discounted, taxRate, shipping) + discounted;
  return {
    subtotal: formatMoney(subtotal),
    total: formatMoney(total),
    itemCount: items.length,
  };
}

module.exports = { buildReceipt };
