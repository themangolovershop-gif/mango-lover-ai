import { randomUUID } from 'node:crypto';

import {
  FulfillmentStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  type Product,
} from '@prisma/client';

import {
  calculateOrderAmounts,
  normalizeCurrency,
  type DecimalInput,
  type OrderCalculationItemInput,
} from '@/backend/modules/orders/order-calculations';
import { NotFoundError, ValidationError } from '@/backend/shared/lib/errors/app-error';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

export type OrderItemInput = {
  productId: string;
  quantity: number;
  unitPrice?: DecimalInput;
  metadataJson?: Prisma.InputJsonValue;
};

export type CreateOrderInput = {
  customerId: string;
  conversationId: string;
  leadId: string;
  items: OrderItemInput[];
  orderNumber?: string;
  deliveryCharge?: DecimalInput;
  discountAmount?: DecimalInput;
  currency?: string;
  notes?: string | null;
  paymentReference?: string | null;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
};

export type UpdateOrderInput = {
  items?: OrderItemInput[];
  deliveryCharge?: DecimalInput;
  discountAmount?: DecimalInput;
  currency?: string;
  notes?: string | null;
  paymentReference?: string | null;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
};

export type ListOrdersFilters = {
  customerId?: string;
  conversationId?: string;
  leadId?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  limit?: number;
};

const orderInclude = {
  items: {
    include: {
      product: true,
    },
  },
} satisfies Prisma.OrderInclude;

function hasOwnProperty<T extends object>(value: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function generateOrderNumber() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `MLS-${timestamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function buildOrderWhere(filters: ListOrdersFilters): Prisma.OrderWhereInput {
  return {
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.conversationId ? { conversationId: filters.conversationId } : {}),
    ...(filters.leadId ? { leadId: filters.leadId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.paymentStatus ? { paymentStatus: filters.paymentStatus } : {}),
  };
}

function isReorderNotes(notes?: string | null) {
  return (notes ?? '').toLowerCase().includes('reorder');
}

async function resolveOrderItems(
  tx: Prisma.TransactionClient,
  items: OrderItemInput[]
): Promise<OrderCalculationItemInput[]> {
  if (items.length === 0) {
    throw new ValidationError('Orders require at least one line item.');
  }

  const productIds = Array.from(new Set(items.map((item) => item.productId)));
  const products = await tx.product.findMany({
    where: {
      id: {
        in: productIds,
      },
    },
  });

  if (products.length !== productIds.length) {
    throw new ValidationError('One or more order items reference a missing product.');
  }

  const productMap = new Map<string, Product>(products.map((product) => [product.id, product]));

  return items.map((item) => {
    const product = productMap.get(item.productId);

    if (!product) {
      throw new ValidationError(`Product ${item.productId} was not found.`);
    }

    if (!product.active) {
      throw new ValidationError(`Product ${product.slug} is inactive and cannot be ordered.`);
    }

    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? product.price,
      ...(item.metadataJson !== undefined ? { metadataJson: item.metadataJson } : {}),
    };
  });
}

export async function listOrders(filters: ListOrdersFilters = {}) {
  const prisma = getPrismaClient();

  return prisma.order.findMany({
    where: buildOrderWhere(filters),
    include: orderInclude,
    orderBy: {
      updatedAt: 'desc',
    },
    take: filters.limit ?? 50,
  });
}

export async function getOrderById(orderId: string) {
  const prisma = getPrismaClient();
  const order = await prisma.order.findUnique({
    where: {
      id: orderId,
    },
    include: orderInclude,
  });

  if (!order) {
    throw new NotFoundError(`Order ${orderId} was not found.`);
  }

  return order;
}

export async function getLatestConversationOrder(conversationId: string) {
  const prisma = getPrismaClient();

  return prisma.order.findFirst({
    where: {
      conversationId,
    },
    include: orderInclude,
    orderBy: {
      updatedAt: 'desc',
    },
  });
}

export async function createOrder(input: CreateOrderInput) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const resolvedItems = await resolveOrderItems(tx, input.items);
    const amounts = calculateOrderAmounts({
      items: resolvedItems,
      deliveryCharge: input.deliveryCharge,
      discountAmount: input.discountAmount,
    });

    const order = await tx.order.create({
      data: {
        customerId: input.customerId,
        conversationId: input.conversationId,
        leadId: input.leadId,
        orderNumber: input.orderNumber?.trim() || generateOrderNumber(),
        status: input.status ?? OrderStatus.DRAFT,
        paymentStatus: input.paymentStatus ?? PaymentStatus.UNPAID,
        fulfillmentStatus: input.fulfillmentStatus ?? FulfillmentStatus.NOT_STARTED,
        subtotal: amounts.subtotal,
        deliveryCharge: amounts.deliveryCharge,
        discountAmount: amounts.discountAmount,
        totalAmount: amounts.total,
        currency: normalizeCurrency(input.currency),
        notes: input.notes ?? null,
        paymentReference: input.paymentReference ?? null,
        items: {
          create: amounts.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            metadataJson: item.metadataJson,
          })),
        },
      },
      include: orderInclude,
    });

    await tx.analyticsEvent.create({
      data: {
        customerId: order.customerId,
        conversationId: order.conversationId,
        leadId: order.leadId,
        orderId: order.id,
        eventType: 'outcome_order_started',
        payloadJson: {
          orderNumber: order.orderNumber,
          totalAmount: Number(order.totalAmount.toString()),
          status: order.status,
          paymentStatus: order.paymentStatus,
          isReorder: isReorderNotes(order.notes),
        } satisfies Prisma.InputJsonObject,
      },
    });

    if (isReorderNotes(order.notes)) {
      await tx.analyticsEvent.create({
        data: {
          customerId: order.customerId,
          conversationId: order.conversationId,
          leadId: order.leadId,
          orderId: order.id,
          eventType: 'outcome_reordered',
          payloadJson: {
            orderNumber: order.orderNumber,
          } satisfies Prisma.InputJsonObject,
        },
      });
    }

    return order;
  });
}

export async function updateOrder(orderId: string, input: UpdateOrderInput) {
  const prisma = getPrismaClient();
  const currentOrder = await prisma.order.findUnique({
    where: {
      id: orderId,
    },
    include: {
      items: true,
    },
  });

  if (!currentOrder) {
    throw new NotFoundError(`Order ${orderId} was not found.`);
  }

  return prisma.$transaction(async (tx) => {
    const calculationItems = input.items
      ? await resolveOrderItems(tx, input.items)
      : currentOrder.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        }));

    const amounts = calculateOrderAmounts({
      items: calculationItems,
      deliveryCharge: input.deliveryCharge ?? currentOrder.deliveryCharge,
      discountAmount: input.discountAmount ?? currentOrder.discountAmount,
    });

    if (input.items) {
      await tx.orderItem.deleteMany({
        where: {
          orderId,
        },
      });

      await tx.orderItem.createMany({
        data: amounts.items.map((item) => ({
          orderId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          metadataJson: item.metadataJson,
        })),
      });
    }

    const data: Prisma.OrderUpdateInput = {
      subtotal: amounts.subtotal,
      deliveryCharge: amounts.deliveryCharge,
      discountAmount: amounts.discountAmount,
      totalAmount: amounts.total,
      currency: normalizeCurrency(input.currency ?? currentOrder.currency),
      ...(input.status ? { status: input.status } : {}),
      ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
      ...(input.fulfillmentStatus ? { fulfillmentStatus: input.fulfillmentStatus } : {}),
    };

    if (hasOwnProperty(input, 'notes')) {
      data.notes = input.notes ?? null;
    }

    if (hasOwnProperty(input, 'paymentReference')) {
      data.paymentReference = input.paymentReference ?? null;
    }

    await tx.order.update({
      where: {
        id: orderId,
      },
      data,
    });

    const updatedOrder = await tx.order.findUnique({
      where: {
        id: orderId,
      },
      include: orderInclude,
    });

    if (!updatedOrder) {
      throw new NotFoundError(`Order ${orderId} was not found after update.`);
    }

    if (
      currentOrder.status !== OrderStatus.CONFIRMED &&
      updatedOrder.status === OrderStatus.CONFIRMED
    ) {
      await tx.analyticsEvent.create({
        data: {
          customerId: updatedOrder.customerId,
          conversationId: updatedOrder.conversationId,
          leadId: updatedOrder.leadId,
          orderId: updatedOrder.id,
          eventType: 'outcome_order_confirmed',
          payloadJson: {
            orderNumber: updatedOrder.orderNumber,
            status: updatedOrder.status,
            paymentStatus: updatedOrder.paymentStatus,
          } satisfies Prisma.InputJsonObject,
        },
      });
    }

    if (!isReorderNotes(currentOrder.notes) && isReorderNotes(updatedOrder.notes)) {
      await tx.analyticsEvent.create({
        data: {
          customerId: updatedOrder.customerId,
          conversationId: updatedOrder.conversationId,
          leadId: updatedOrder.leadId,
          orderId: updatedOrder.id,
          eventType: 'outcome_reordered',
          payloadJson: {
            orderNumber: updatedOrder.orderNumber,
          } satisfies Prisma.InputJsonObject,
        },
      });
    }

    return updatedOrder;
  });
}
