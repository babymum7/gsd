# Money

## Amounts

- Every amount is a whole number of cents: inputs, results, and every step between them. No step works in fractional currency.
- A percentage of an amount is rounded to the nearest cent with `roundHalfEven` from `src/orders/money.js`, so an exact half cent goes to the even cent: 10% of 1,005 cents is 100 cents, and 10% of 1,015 cents is 102 cents.

## Reductions

- Nothing taken off an amount takes it below zero: a reduction larger than the amount is capped at the amount, and the capped figure is what was taken off.
