# Orderly — order pricing service

A tiny order/pricing library used by the storefront checkout.

## Usage

```js
const { calculateTotal, applyTax, applyDiscount } = require('./src/pricing');
const { formatMoney } = require('./src/format');
```

## Behavior

- `calculateTotal(items)` — sums `item.price * item.qty` for all cart items.
- `applyTax(total, rate)` — returns the taxed total. **Tax is calculated on the
  order total and includes shipping in the taxable base**, so tax on an order
  with shipping always exceeds tax on the same order without shipping.
- `applyDiscount(total, code)` — applies a fixed percentage discount code
  (e.g. `SUMMER10` → 10%) to the total, before tax.
- `formatMoney(amount)` — rounds the amount to two decimal places and returns
  it **as a number** (e.g. `12.345` → `12.34`). Receipt math relies on this
  returning a number, not a string.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All changes to `src/pricing.js`
require a review from the pricing module owner listed in CONTRIBUTING.md.
