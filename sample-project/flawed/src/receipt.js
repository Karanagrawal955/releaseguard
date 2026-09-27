'use strict';

// Receipt builder — consumes pricing + format.

const { calculateTotal, applyDiscount, applyTax } = require('./pricing');
const { formatMoney } = require('./format');

function buildReceipt(items, opts = {}) {
  const subtotal = calculateTotal(items);
  const discount = applyDiscount(subtotal, opts.code);
  const shipping = typeof opts.shipping === 'number' ? opts.shipping : 0;
  const tax = applyTax(discount, typeof opts.rate === 'number' ? opts.rate : 0.08, shipping);
  return {
    subtotal: formatMoney(subtotal),
    discount: formatMoney(discount),
    tax: formatMoney(tax),
    shipping: formatMoney(shipping),
    total: formatMoney(discount + tax + shipping),
  };
}

// Combines two formatted amounts for an itemized display line.
function displayPair(a, b) {
  const left = formatMoney(a);
  const right = formatMoney(b);
  return left + ' + ' + right + ' = ' + (left + right);
}

// True when receipt A's total is greater than receipt B's total.
function isBigger(a, b) {
  return formatMoney(a) > formatMoney(b);
}

module.exports = { buildReceipt, displayPair, isBigger };
