'use strict';

// Formatting helpers for receipts.

/**
 * Round a numeric amount to two decimal places.
 * Returns a number rounded to cents.
 */
function formatMoney(amount) {
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    throw new TypeError('amount must be a number');
  }
  return Math.round(amount * 100) / 100;
}

module.exports = { formatMoney };
