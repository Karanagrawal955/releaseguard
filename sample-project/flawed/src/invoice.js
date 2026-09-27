'use strict';

// Invoice assembly — consumes receipt totals.

const { formatMoney } = require('./format');
const { buildReceipt } = require('./receipt');

const LATE_FEE = 2.5;

function invoiceFor(items, opts = {}) {
  const receipt = buildReceipt(items, opts);
  const lateFee = opts.late ? formatMoney(LATE_FEE) : formatMoney(0);
  return {
    lines: [
      { label: 'Subtotal', amount: receipt.subtotal },
      { label: 'Tax', amount: receipt.tax },
      { label: 'Shipping', amount: receipt.shipping },
      { label: 'Late fee', amount: lateFee },
    ],
    // Invoice grand total is computed from already-formatted numbers.
    grandTotal: receipt.subtotal + receipt.tax + receipt.shipping + lateFee,
  };
}

module.exports = { invoiceFor, LATE_FEE };
