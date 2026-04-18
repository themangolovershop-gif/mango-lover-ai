import { describe, expect, it } from 'vitest';

import { calculateOrderAmounts, normalizeCurrency } from '@/backend/modules/orders/order-calculations';

describe('order-calculations', () => {
  it('calculates subtotal, delivery, discount, and total deterministically', () => {
    const result = calculateOrderAmounts({
      items: [
        {
          productId: 'prod-large',
          quantity: 2,
          unitPrice: 1899,
        },
      ],
      deliveryCharge: 120,
      discountAmount: 200,
    });

    expect(result.subtotal.toFixed(2)).toBe('3798.00');
    expect(result.deliveryCharge.toFixed(2)).toBe('120.00');
    expect(result.discountAmount.toFixed(2)).toBe('200.00');
    expect(result.total.toFixed(2)).toBe('3718.00');
    expect(result.items[0]?.lineTotal.toFixed(2)).toBe('3798.00');
  });

  it('rejects empty line item payloads', () => {
    expect(() =>
      calculateOrderAmounts({
        items: [],
      })
    ).toThrow('Orders require at least one line item.');
  });

  it('normalizes supported currencies and rejects invalid ones', () => {
    expect(normalizeCurrency('inr')).toBe('INR');
    expect(() => normalizeCurrency('rupees')).toThrow('Currency must be a valid 3-letter ISO code.');
  });
});
