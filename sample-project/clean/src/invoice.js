'use strict';

// src/invoice.js — invoice assembly. Owned by Priya Sharma.

const { calculateTotal, applyDiscount, applyTax } = require('./pricing');
const { formatMoney } = require('./format');
const { validateCart } = require('./cart');

/**
 * Build an invoice for a cart + customer. Same math as buildReceipt,
 * plus customer and payment terms.
 */
function buildInvoice(items, customer, { shipping = 0, taxRate = 0.1, discountCode, dueDays = 30 } = {}) {
  validateCart(items);
  const subtotal = calculateTotal(items);
  const discounted = discountCode ? applyDiscount(subtotal, discountCode) : subtotal;
  const total = applyTax(discounted, taxRate, shipping) + discounted;
  return {
    customer: customer.name,
    email: customer.email,
    subtotal: formatMoney(subtotal),
    total: formatMoney(total),
    dueDays,
  };
}

module.exports = { buildInvoice };
