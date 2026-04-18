import { Prisma } from '@prisma/client';

import { ValidationError } from '@/backend/shared/lib/errors/app-error';

export type DecimalInput = Prisma.Decimal | string | number;

export type OrderCalculationItemInput = {
  productId: string;
  quantity: number;
  unitPrice: DecimalInput;
  metadataJson?: Prisma.InputJsonValue;
};

export type CalculatedOrderItem = {
  productId: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  metadataJson?: Prisma.InputJsonValue;
};

export function toDecimal(value: DecimalInput, fieldName: string) {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new ValidationError(`${fieldName} must be a valid decimal value.`);
  }
}

function normalizeMoney(value: DecimalInput, fieldName: string) {
  const decimal = toDecimal(value, fieldName).toDecimalPlaces(2);

  if (decimal.isNegative()) {
    throw new ValidationError(`${fieldName} cannot be negative.`);
  }

  return decimal;
}

function normalizeQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError('Order item quantity must be a positive integer.');
  }

  return quantity;
}

export function normalizeCurrency(currency = 'INR') {
  const normalized = currency.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ValidationError('Currency must be a valid 3-letter ISO code.');
  }

  return normalized;
}

export function calculateOrderAmounts(input: {
  items: OrderCalculationItemInput[];
  deliveryCharge?: DecimalInput;
  discountAmount?: DecimalInput;
}) {
  if (input.items.length === 0) {
    throw new ValidationError('Orders require at least one line item.');
  }

  const calculatedItems: CalculatedOrderItem[] = input.items.map((item, index) => {
    const quantity = normalizeQuantity(item.quantity);
    const unitPrice = normalizeMoney(item.unitPrice, `items[${index}].unitPrice`);
    const lineTotal = unitPrice.mul(quantity).toDecimalPlaces(2);

    return {
      productId: item.productId,
      quantity,
      unitPrice,
      lineTotal,
      ...(item.metadataJson !== undefined ? { metadataJson: item.metadataJson } : {}),
    };
  });

  const subtotal = calculatedItems
    .reduce((sum, item) => sum.plus(item.lineTotal), new Prisma.Decimal(0))
    .toDecimalPlaces(2);
  const deliveryCharge = normalizeMoney(input.deliveryCharge ?? 0, 'deliveryCharge');
  const discountAmount = normalizeMoney(input.discountAmount ?? 0, 'discountAmount');
  const total = subtotal.plus(deliveryCharge).minus(discountAmount).toDecimalPlaces(2);

  if (total.isNegative()) {
    throw new ValidationError('Discount amount cannot exceed the order subtotal plus delivery.');
  }

  return {
    items: calculatedItems,
    subtotal,
    deliveryCharge,
    discountAmount,
    total,
  };
}
