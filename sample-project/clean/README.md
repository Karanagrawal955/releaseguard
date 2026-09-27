# Orderly — order pricing service

A tiny order/pricing library used by the storefront checkout.

## Module map

- `src/cart.js` — cart validation.
- `src/pricing.js` — pricing math (subtotal, discounts, tax).
- `src/format.js` — money formatting.
- `src/receipt.js` — receipt assembly.
- `src/invoice.js` — invoice assembly.

## Behavior

- `calculateTotal(items)` — sums `item.price * item.qty` for all cart items.
- `applyTax(total, rate, shipping)` — returns the **tax amount** for the order
  (not an incremented total). **Shipping is part of the taxable base**: tax is
  computed on `total + shipping`, so tax on an order with shipping always
  exceeds tax on the same order without shipping.
- `applyDiscount(total, code)` — applies a fixed percentage discount code
  (e.g. `SUMMER10` → 10%) to the total, before tax.
- `formatMoney(amount)` — rounds the amount to two decimal places and returns
  it **as a number** (e.g. `12.346` → `12.35`). Receipt math relies on this
  returning a number, not a string.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every module under `src/` must have a
matching file under `tests/`; run `npm test` before opening a PR.
