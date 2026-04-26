import {
  EscalationSeverity,
  EscalationStatus,
  EscalationType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ProductSize,
} from '@prisma/client';

import { createEscalation } from '@/backend/modules/escalations/escalation.service';
import { scheduleFollowUp } from '@/backend/modules/followups/follow-up.service';
import { searchBusinessKnowledge, searchMangoKnowledge, summarizeKnowledgeResults } from '@/backend/modules/knowledge/knowledge.service';
import { syncCustomerMemoryContext } from '@/backend/modules/memory/memory.service';
import { calculateOrderAmounts } from '@/backend/modules/orders/order-calculations';
import { createOrder, getLatestConversationOrder, listOrders, updateOrder } from '@/backend/modules/orders/order.service';
import { createPayment, listPayments, updatePayment } from '@/backend/modules/payments/payment.service';
import { mapSizeToProductSize } from '@/backend/modules/products/product-helpers';
import { getActiveProductBySize } from '@/backend/modules/products/product.service';
import { buildOrderSummary } from '@/backend/modules/whatsapp/message-orchestrator.helpers';
import { BRAND_CONTEXT } from '@/backend/shared/constants/brand';
import { getPrismaClient } from '@/backend/shared/lib/prisma';
import { normalizeMessage } from '@/backend/shared/utils/normalization';

import type { ToolExecutionContext, ToolExecutionResult, ToolInvocation, ToolPlan } from './tool.types';

type JsonRecord = Record<string, unknown>;

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function normalizeCityKey(city: string) {
  return normalizeMessage(city).replace(/\s+/g, ' ').trim();
}

function formatMoney(value: Prisma.Decimal | number) {
  return Number(value.toString()).toFixed(2);
}

function formatOrderStatus(status: OrderStatus) {
  switch (status) {
    case OrderStatus.DRAFT:
      return 'in draft';
    case OrderStatus.AWAITING_CONFIRMATION:
      return 'awaiting confirmation';
    case OrderStatus.CONFIRMED:
      return 'confirmed';
    case OrderStatus.CANCELLED:
      return 'cancelled';
    default:
      return String(status).toLowerCase().replace(/_/g, ' ');
  }
}

function formatPaymentStatus(status: PaymentStatus) {
  switch (status) {
    case PaymentStatus.UNPAID:
      return 'payment pending';
    case PaymentStatus.SUBMITTED:
      return 'payment submitted';
    case PaymentStatus.VERIFIED:
      return 'payment verified';
    case PaymentStatus.FAILED:
      return 'payment failed';
    case PaymentStatus.PARTIAL:
      return 'partial payment received';
    case PaymentStatus.REFUNDED:
      return 'payment refunded';
    default:
      return String(status).toLowerCase().replace(/_/g, ' ');
  }
}

function isMutableOrderStatus(status: OrderStatus) {
  const mutableStatuses: OrderStatus[] = [
    OrderStatus.DRAFT,
    OrderStatus.AWAITING_CONFIRMATION,
  ];

  return mutableStatuses.includes(status);
}

function describeOrder(order: NonNullable<Awaited<ReturnType<typeof getLatestConversationOrder>>>, city?: string | null) {
  const firstItem = order.items[0];
  const quantity = firstItem?.quantity ?? 0;
  const size = firstItem?.product?.size ? firstItem.product.size.toLowerCase() : 'selected';
  const cityText = city ? ` for ${titleCase(city)} delivery` : '';

  return `${quantity} dozen ${titleCase(size)} Devgad Alphonso${cityText}`;
}

function getChargeFromMap(record: JsonRecord, city?: string) {
  if (!city) {
    return undefined;
  }

  const normalizedCity = normalizeCityKey(city);

  for (const [key, value] of Object.entries(record)) {
    if (normalizeCityKey(key) === normalizedCity) {
      return toNumber(value);
    }
  }

  return undefined;
}

function resolveDeliveryChargeFromProduct(args: {
  product: {
    deliveryRulesJson: Prisma.JsonValue | null;
    cityRulesJson: Prisma.JsonValue | null;
  };
  city?: string;
}) {
  const deliveryRules = asRecord(args.product.deliveryRulesJson);
  const cityRules = asRecord(args.product.cityRulesJson);
  const allowedCities = asStringArray(cityRules?.allowedCities).map(normalizeCityKey);
  const blockedCities = asStringArray(cityRules?.blockedCities).map(normalizeCityKey);
  const cityKey = args.city ? normalizeCityKey(args.city) : undefined;

  if (cityKey && allowedCities.length > 0 && !allowedCities.includes(cityKey)) {
    return {
      available: false,
      charge: undefined,
      isEstimated: false,
      note: `Delivery is not configured for ${titleCase(args.city ?? cityKey)} in the current city rules.`,
    };
  }

  if (cityKey && blockedCities.includes(cityKey)) {
    return {
      available: false,
      charge: undefined,
      isEstimated: false,
      note: `Delivery is blocked for ${titleCase(args.city ?? cityKey)} in the current city rules.`,
    };
  }

  const directCharge =
    getChargeFromMap(asRecord(deliveryRules?.cityCharges) ?? {}, args.city) ??
    getChargeFromMap(asRecord(deliveryRules?.chargesByCity) ?? {}, args.city) ??
    getChargeFromMap(asRecord(deliveryRules?.cities) ?? {}, args.city) ??
    getChargeFromMap(asRecord(deliveryRules?.perCity) ?? {}, args.city) ??
    getChargeFromMap(deliveryRules ?? {}, args.city);

  if (directCharge !== undefined) {
    return {
      available: true,
      charge: directCharge,
      isEstimated: false,
      note: `Configured delivery charge for ${titleCase(args.city ?? '')}.`,
    };
  }

  const defaultCharge =
    toNumber(deliveryRules?.defaultCharge) ??
    toNumber(deliveryRules?.baseCharge) ??
    toNumber(deliveryRules?.deliveryCharge) ??
    toNumber(deliveryRules?.default);

  if (defaultCharge !== undefined) {
    return {
      available: true,
      charge: defaultCharge,
      isEstimated: !args.city,
      note: args.city
        ? `Using the default delivery charge for ${titleCase(args.city)}.`
        : 'Using the default delivery charge.',
    };
  }

  return {
    available: true,
    charge: 0,
    isEstimated: Boolean(args.city),
    note: args.city
      ? `No city-specific delivery charge is configured for ${titleCase(args.city)}.`
      : 'No delivery charge is configured.',
  };
}

export class ToolExecutorService {
  async executePlan(plan: ToolPlan, context: ToolExecutionContext) {
    const results: ToolExecutionResult[] = [];

    for (const tool of plan.tools) {
      results.push(await this.executeTool(tool, context));
    }

    return results;
  }

  async executeTool(tool: ToolInvocation, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    switch (tool.name) {
      case 'get_current_order_summary':
        return this.getCurrentOrderSummary(context);
      case 'create_draft_order':
        return this.createDraftOrder(tool.args ?? {}, context);
      case 'update_order_quantity':
        return this.updateOrderQuantity(tool.args ?? {}, context);
      case 'update_order_size':
        return this.updateOrderSize(tool.args ?? {}, context);
      case 'update_order_address':
        return this.updateOrderAddress(tool.args ?? {}, context);
      case 'restart_order_session':
        return this.restartOrderSession(context);
      case 'confirm_order':
        return this.confirmOrder(context);
      case 'get_payment_status':
        return this.getPaymentStatus(context);
      case 'mark_payment_submitted':
        return this.markPaymentSubmitted(tool.args ?? {}, context);
      case 'verify_payment':
        return this.verifyPayment(tool.args ?? {}, context);
      case 'get_product_by_size':
        return this.getProductBySize(tool.args ?? {}, context);
      case 'get_catalog_overview':
        return this.getCatalogOverview();
      case 'get_quote':
        return this.getQuote(tool.args ?? {}, context);
      case 'get_delivery_charge':
        return this.getDeliveryCharge(tool.args ?? {}, context);
      case 'get_customer_memory':
        return this.getCustomerMemory(context);
      case 'get_lead_status':
        return this.getLeadStatus(context);
      case 'update_customer_memory':
        return this.updateCustomerMemory(tool.args ?? {}, context);
      case 'schedule_followup':
        return this.scheduleFollowUp(tool.args ?? {}, context);
      case 'escalate_to_human':
        return this.escalateToHuman(tool.args ?? {}, context);
      case 'get_order_history':
        return this.getOrderHistory(context);
      case 'get_last_successful_order':
        return this.getLastSuccessfulOrder(context);
      case 'reorder_last_order':
        return this.reorderLastOrder(context);
      case 'search_mango_knowledge':
        return this.searchKnowledge('mango', tool.args ?? {}, context);
      case 'search_business_knowledge':
        return this.searchKnowledge('business', tool.args ?? {}, context);
      default:
        return {
          name: tool.name,
          ok: false,
          summary: `Tool ${tool.name} is not implemented.`,
        };
    }
  }

  private async getCurrentOrderSummary(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const prisma = getPrismaClient();
    const order = await getLatestConversationOrder(context.conversationId);
    const customer = await prisma.customer.findUnique({
      where: {
        id: context.customerId,
      },
      select: {
        city: true,
      },
    });

    if (!order || order.status === OrderStatus.CANCELLED) {
      return {
        name: 'get_current_order_summary',
        ok: false,
        summary: 'No active order was found for the current conversation.',
        replyHint:
          'I do not see an active order right now. If you want, I can help you start a new one or check your last successful order.',
      };
    }

    const friendlySummary = describeOrder(order, customer?.city);
    const replyHint = `You currently have ${friendlySummary} ${formatOrderStatus(order.status)}. Payment is ${formatPaymentStatus(order.paymentStatus)}. If you want, I can help you confirm it or make changes.`;

    return {
      name: 'get_current_order_summary',
      ok: true,
      summary: buildOrderSummary(order) ?? 'Active order found.',
      replyHint,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
      },
    };
  }

  private async getPaymentStatus(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const order = await getLatestConversationOrder(context.conversationId);

    if (!order || order.status === OrderStatus.CANCELLED) {
      return {
        name: 'get_payment_status',
        ok: false,
        summary: 'No active order is available for payment lookup.',
        replyHint:
          'I do not see an active order to check the payment status for right now. If you want, I can help you start fresh or review your last order.',
      };
    }

    return {
      name: 'get_payment_status',
      ok: true,
      summary: `Payment status for ${order.orderNumber}: ${order.paymentStatus}. Order status ${order.status}.`,
      replyHint: `Your current order is ${formatOrderStatus(order.status)}, and the payment is ${formatPaymentStatus(order.paymentStatus)}. If you want, I can guide the next step from here.`,
      data: {
        orderId: order.id,
        paymentStatus: order.paymentStatus,
        orderStatus: order.status,
      },
    };
  }

  private async getProductBySize(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const size = typeof args.size === 'string' ? args.size : context.entities.size;
    const productSize = mapSizeToProductSize(size);

    if (!productSize) {
      return {
        name: 'get_product_by_size',
        ok: false,
        summary: 'Product size is missing for product lookup.',
        replyHint: 'Tell me whether you want Medium, Large, or Jumbo, and I can quote the active option.',
      };
    }

    const product = await getActiveProductBySize(productSize);
    const sizeLabel = product.size.toLowerCase();

    return {
      name: 'get_product_by_size',
      ok: true,
      summary: `Active ${sizeLabel} product ${product.name} is priced at INR ${formatMoney(product.price)} per dozen.`,
      replyHint: `The current price for ${titleCase(sizeLabel)} Devgad Alphonso is INR ${formatMoney(product.price)} per dozen. Tell me the quantity and city if you want a full quote.`,
      data: {
        productId: product.id,
        price: Number(product.price.toString()),
        size: sizeLabel,
      },
    };
  }

  private async getCatalogOverview(): Promise<ToolExecutionResult> {
    const prisma = getPrismaClient();
    const products = await prisma.product.findMany({
      where: {
        active: true,
      },
      select: {
        name: true,
        size: true,
        price: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const medium = products.find((product) => product.size === ProductSize.MEDIUM);
    const large = products.find((product) => product.size === ProductSize.LARGE);
    const jumbo = products.find((product) => product.size === ProductSize.JUMBO);

    const lines = [
      medium
        ? `Medium INR ${formatMoney(medium.price)} (${BRAND_CONTEXT.products.weights.medium})`
        : null,
      large
        ? `Large INR ${formatMoney(large.price)} (${BRAND_CONTEXT.products.weights.large})`
        : null,
      jumbo
        ? `Jumbo INR ${formatMoney(jumbo.price)} (${BRAND_CONTEXT.products.weights.jumbo})`
        : null,
    ].filter((line): line is string => Boolean(line));

    return {
      name: 'get_catalog_overview',
      ok: lines.length > 0,
      summary: `Active catalog: ${lines.join('; ')}.`,
      replyHint: `Current premium mango availability is ${lines.join(', ')}. Tell me the size and quantity you want, and I will guide you properly from there.`,
      data: {
        products: products.map((product) => ({
          name: product.name,
          size: product.size,
          price: Number(product.price.toString()),
        })),
      },
    };
  }

  private async getDeliveryCharge(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const size = typeof args.size === 'string' ? args.size : context.entities.size;
    const city = typeof args.city === 'string' ? args.city : context.entities.city;
    const derivedSize = mapSizeToProductSize(size) ?? context.latestOrder?.items[0]?.product?.size ?? null;

    if (!city) {
      return {
        name: 'get_delivery_charge',
        ok: false,
        summary: 'City is missing for delivery charge lookup.',
        replyHint: 'Share the delivery city, and I can check the current delivery handling.',
      };
    }

    if (!derivedSize) {
      return {
        name: 'get_delivery_charge',
        ok: false,
        summary: 'Product size is missing for delivery charge lookup.',
        replyHint: 'Tell me the size you want as well, and I can check the current delivery handling for your city.',
      };
    }

    const product = await getActiveProductBySize(derivedSize as ProductSize);
    const delivery = resolveDeliveryChargeFromProduct({
      product,
      city,
    });

    if (!delivery.available) {
      return {
        name: 'get_delivery_charge',
        ok: false,
        summary: delivery.note ?? 'Delivery is not configured for the requested city.',
        replyHint: delivery.note ?? `I do not have confirmed delivery configured for ${titleCase(city)} in the current rules.`,
      };
    }

    return {
      name: 'get_delivery_charge',
      ok: true,
      summary: `Delivery charge for ${titleCase(city)} is INR ${formatMoney(delivery.charge ?? 0)}.${delivery.note ? ` ${delivery.note}` : ''}`,
      replyHint: delivery.isEstimated
        ? `For ${titleCase(city)}, I can currently see INR ${formatMoney(delivery.charge ?? 0)} from the configured delivery data. If needed, I can also confirm whether any extra city handling applies.`
        : `The current delivery charge for ${titleCase(city)} is INR ${formatMoney(delivery.charge ?? 0)}.`,
      data: {
        city,
        charge: delivery.charge ?? 0,
        isEstimated: delivery.isEstimated,
      },
    };
  }

  private async getQuote(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const size = typeof args.size === 'string' ? args.size : context.entities.size;
    const quantityDozen =
      typeof args.quantityDozen === 'number' ? args.quantityDozen : context.entities.quantityDozen;
    const city = typeof args.city === 'string' ? args.city : context.entities.city;
    const productSize = mapSizeToProductSize(size);

    if (!productSize || !quantityDozen) {
      return {
        name: 'get_quote',
        ok: false,
        summary: 'Size or quantity is missing for quote calculation.',
        replyHint: 'Tell me the size and quantity you want, and I can prepare the current quote for you.',
      };
    }

    const product = await getActiveProductBySize(productSize);
    const delivery = resolveDeliveryChargeFromProduct({
      product,
      city,
    });

    if (!delivery.available) {
      return {
        name: 'get_quote',
        ok: false,
        summary: delivery.note ?? 'Delivery is not configured for the requested city.',
        replyHint: delivery.note ?? 'I need to confirm the city delivery rule before quoting this order.',
      };
    }

    const amounts = calculateOrderAmounts({
      items: [
        {
          productId: product.id,
          quantity: quantityDozen,
          unitPrice: product.price,
        },
      ],
      deliveryCharge: delivery.charge ?? 0,
    });
    const sizeLabel = product.size.toLowerCase();
    const cityText = city ? ` for ${titleCase(city)}` : '';
    const replyHint = !city
      ? `The base price for ${quantityDozen} dozen ${titleCase(sizeLabel)} Devgad Alphonso is INR ${formatMoney(amounts.subtotal)} before delivery handling. Share the delivery city, and I will guide you with the complete quote.`
      : delivery.isEstimated
        ? `The current quote for ${quantityDozen} dozen ${titleCase(sizeLabel)} Devgad Alphonso${cityText} is INR ${formatMoney(amounts.total)}. That uses the available pricing data, and I can confirm any extra city handling if needed.`
        : `The current quote for ${quantityDozen} dozen ${titleCase(sizeLabel)} Devgad Alphonso${cityText} is INR ${formatMoney(amounts.total)}. If you want, I can prepare that for you now.`;

    return {
      name: 'get_quote',
      ok: true,
      summary: `Quote: subtotal INR ${formatMoney(amounts.subtotal)}, delivery INR ${formatMoney(amounts.deliveryCharge)}, total INR ${formatMoney(amounts.total)}.`,
      replyHint,
      data: {
        productId: product.id,
        subtotal: Number(amounts.subtotal.toString()),
        deliveryCharge: Number(amounts.deliveryCharge.toString()),
        total: Number(amounts.total.toString()),
        isEstimated: delivery.isEstimated,
      },
    };
  }

  private async getCustomerMemory(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const memory =
      context.memorySnapshot ??
      (await syncCustomerMemoryContext({
        customerId: context.customerId,
        conversationId: context.conversationId,
        customerName: undefined,
        phone: context.phone,
        leadStage: context.leadStage,
        buyerType: context.buyerType,
        leadScore: 0,
        intents: context.intents,
        nextAction: context.nextAction,
        latestOrder: context.latestOrder,
        latestUserMessage: context.latestUserMessage,
      }));

    return {
      name: 'get_customer_memory',
      ok: true,
      summary: `Customer memory: repeat=${memory.profile.repeatCustomer}, preferredSize=${memory.profile.preferredSize ?? 'unknown'}, buyerType=${memory.profile.buyerType ?? 'unknown'}, vip=${memory.personalization.isVip}.`,
      data: {
        profile: memory.profile,
        personalization: memory.personalization,
      },
    };
  }

  private async getLeadStatus(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const prisma = getPrismaClient();
    const lead = await prisma.lead.findUnique({
      where: {
        id: context.leadId,
      },
      select: {
        stage: true,
        score: true,
        temperature: true,
        needsHuman: true,
      },
    });

    if (!lead) {
      return {
        name: 'get_lead_status',
        ok: false,
        summary: 'Lead status was not found.',
      };
    }

    return {
      name: 'get_lead_status',
      ok: true,
      summary: `Lead stage ${lead.stage}, score ${lead.score}, temperature ${lead.temperature}, needsHuman=${lead.needsHuman}.`,
      data: lead as unknown as Record<string, unknown>,
    };
  }

  private async getOrderHistory(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const orders = await listOrders({
      customerId: context.customerId,
      limit: 5,
    });

    if (orders.length === 0) {
      return {
        name: 'get_order_history',
        ok: false,
        summary: 'No order history found for the customer.',
      };
    }

    return {
      name: 'get_order_history',
      ok: true,
      summary: orders
        .map((order) => `${order.orderNumber}: ${order.status} / ${order.paymentStatus}`)
        .join('; '),
      data: {
        orders: orders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
        })),
      },
    };
  }

  private async getLastSuccessfulOrder(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const prisma = getPrismaClient();
    const customer = await prisma.customer.findUnique({
      where: {
        id: context.customerId,
      },
      select: {
        city: true,
      },
    });
    const order = await prisma.order.findFirst({
      where: {
        customerId: context.customerId,
        OR: [
          {
            status: {
              in: [OrderStatus.CONFIRMED],
            },
          },
          {
            paymentStatus: PaymentStatus.VERIFIED,
          },
        ],
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!order) {
      return {
        name: 'get_last_successful_order',
        ok: false,
        summary: 'No successful order history is available.',
        replyHint: 'I do not see a previous confirmed order yet. If you want, I can help you start a fresh order.',
      };
    }

    const description = describeOrder(order, customer?.city);

    return {
      name: 'get_last_successful_order',
      ok: true,
      summary: `Last successful order: ${description}. Status ${order.status}.`,
      replyHint: `Your last successful order was ${description}. If you want, I can arrange the same again or make changes.`,
      data: {
        orderId: order.id,
        productId: order.items[0]?.productId,
        quantity: order.items[0]?.quantity,
        size: order.items[0]?.product?.size,
      },
    };
  }

  private async reorderLastOrder(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const result = await this.createDraftOrder(
      {
        source: 'last_successful_order',
      },
      context
    );

    return {
      ...result,
      name: 'reorder_last_order',
    };
  }

  private async createDraftOrder(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const source = typeof args.source === 'string' ? args.source : 'manual';
    const prisma = getPrismaClient();
    const customer = await prisma.customer.findUnique({
      where: {
        id: context.customerId,
      },
      select: {
        city: true,
      },
    });
    const latestOrder = await getLatestConversationOrder(context.conversationId);
    const lastSuccessful = await prisma.order.findFirst({
      where: {
        customerId: context.customerId,
        OR: [
          {
            status: {
              in: [OrderStatus.CONFIRMED],
            },
          },
          {
            paymentStatus: PaymentStatus.VERIFIED,
          },
        ],
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (source === 'last_successful_order' && !lastSuccessful) {
      return {
        name: 'create_draft_order',
        ok: false,
        summary: 'No successful order was found to reorder from.',
        replyHint: 'I do not see a previous confirmed order yet. Tell me the size and quantity you want, and I can prepare a fresh draft.',
      };
    }

    const sourceOrder = lastSuccessful ?? latestOrder;

    if (!sourceOrder || sourceOrder.items.length === 0) {
      return {
        name: 'create_draft_order',
        ok: false,
        summary: 'No source order data is available to create a draft order.',
        replyHint: 'Tell me the size and quantity you want, and I can prepare the draft for you.',
      };
    }

    const firstItem = sourceOrder.items[0];
    const targetOrder =
      latestOrder && isMutableOrderStatus(latestOrder.status)
        ? await updateOrder(latestOrder.id, {
            items: [
              {
                productId: firstItem.productId,
                quantity: firstItem.quantity,
              },
            ],
            deliveryCharge: sourceOrder.deliveryCharge,
            discountAmount: sourceOrder.discountAmount,
            notes: 'Reordered from previous successful order.',
          })
        : await createOrder({
            customerId: context.customerId,
            conversationId: context.conversationId,
            leadId: context.leadId,
            items: [
              {
                productId: firstItem.productId,
                quantity: firstItem.quantity,
              },
            ],
            deliveryCharge: sourceOrder.deliveryCharge,
            discountAmount: sourceOrder.discountAmount,
            currency: sourceOrder.currency,
            notes: 'Reordered from previous successful order.',
          });
    const description = describeOrder(targetOrder, customer?.city);

    return {
      name: 'create_draft_order',
      ok: true,
      summary: `Prepared draft order ${targetOrder.orderNumber} from previous order data.`,
      replyHint: `I have prepared your previous selection again as ${description}. Tell me if you want the same details or any change.`,
      data: {
        orderId: targetOrder.id,
        orderNumber: targetOrder.orderNumber,
      },
    };
  }

  private async updateOrderQuantity(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const quantityDozen = typeof args.quantityDozen === 'number' ? args.quantityDozen : context.entities.quantityDozen;
    const order = await getLatestConversationOrder(context.conversationId);

    if (!order || !isMutableOrderStatus(order.status) || !quantityDozen || !order.items[0]) {
      return {
        name: 'update_order_quantity',
        ok: false,
        summary: 'No mutable order is available for quantity update.',
        replyHint: 'I do not see an editable draft order right now. If you want, I can help you start a fresh order.',
      };
    }

    const updatedOrder = await updateOrder(order.id, {
      items: [
        {
          productId: order.items[0].productId,
          quantity: quantityDozen,
        },
      ],
    });
    const refreshed = await this.getCurrentOrderSummary(context);

    return {
      name: 'update_order_quantity',
      ok: true,
      summary: `Updated order ${updatedOrder.orderNumber} quantity to ${quantityDozen} dozen.`,
      replyHint: `I have updated the quantity to ${quantityDozen} dozen. ${refreshed.replyHint ?? ''}`.trim(),
      data: {
        orderId: updatedOrder.id,
        quantityDozen,
      },
    };
  }

  private async updateOrderSize(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const size = typeof args.size === 'string' ? args.size : context.entities.size;
    const productSize = mapSizeToProductSize(size);
    const order = await getLatestConversationOrder(context.conversationId);

    if (!order || !isMutableOrderStatus(order.status) || !productSize || !order.items[0]) {
      return {
        name: 'update_order_size',
        ok: false,
        summary: 'No mutable order is available for size update.',
        replyHint: 'I do not see an editable draft order right now. If you want, I can help you start a fresh order.',
      };
    }

    const product = await getActiveProductBySize(productSize);
    const updatedOrder = await updateOrder(order.id, {
      items: [
        {
          productId: product.id,
          quantity: order.items[0].quantity,
        },
      ],
    });
    const refreshed = await this.getCurrentOrderSummary(context);

    return {
      name: 'update_order_size',
      ok: true,
      summary: `Updated order ${updatedOrder.orderNumber} to ${product.size.toLowerCase()}.`,
      replyHint: `I have updated the order to ${titleCase(product.size.toLowerCase())}. ${refreshed.replyHint ?? ''}`.trim(),
      data: {
        orderId: updatedOrder.id,
        size: product.size.toLowerCase(),
      },
    };
  }

  private async updateOrderAddress(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const prisma = getPrismaClient();
    const addressText =
      typeof args.addressText === 'string' && args.addressText.trim()
        ? args.addressText.trim()
        : context.latestUserMessage;
    const city = typeof args.city === 'string' ? args.city : context.entities.city;
    const pinCode = typeof args.pinCode === 'string' ? args.pinCode : context.entities.pinCode;
    const customer = await prisma.customer.findUnique({
      where: {
        id: context.customerId,
      },
      include: {
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        },
      },
    });

    if (!customer) {
      return {
        name: 'update_order_address',
        ok: false,
        summary: 'Customer was not found for address update.',
      };
    }

    const existingAddress = customer.addresses[0];
    const line1 = addressText.split(',')[0]?.trim() || addressText;
    const savedAddress = existingAddress
      ? await prisma.customerAddress.update({
          where: {
            id: existingAddress.id,
          },
          data: {
            line1,
            city: city ?? existingAddress.city,
            state: customer.state ?? existingAddress.state,
            pinCode: pinCode ?? existingAddress.pinCode,
            isDefault: true,
          },
        })
      : await prisma.customerAddress.create({
          data: {
            customerId: context.customerId,
            line1,
            city: city ?? customer.city ?? 'Unknown',
            state: customer.state ?? 'Unknown',
            pinCode: pinCode ?? customer.pinCode ?? '000000',
            isDefault: true,
          },
        });

    await prisma.customer.update({
      where: {
        id: context.customerId,
      },
      data: {
        city: city ?? customer.city,
        pinCode: pinCode ?? customer.pinCode,
      },
    });

    return {
      name: 'update_order_address',
      ok: true,
      summary: `Updated the default delivery address to ${savedAddress.line1}, ${savedAddress.city}.`,
      replyHint: `I have updated the delivery address details for ${titleCase(savedAddress.city)}. If you want, I can continue with the current order from here.`,
      data: {
        addressId: savedAddress.id,
        city: savedAddress.city,
      },
    };
  }

  private async restartOrderSession(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const order = await getLatestConversationOrder(context.conversationId);

    if (!order || !isMutableOrderStatus(order.status)) {
      return {
        name: 'restart_order_session',
        ok: true,
        summary: 'No mutable order existed, so the session is already clear.',
        replyHint: 'Understood. We can start fresh. Tell me the size and quantity you want, and I will guide you.',
      };
    }

    await updateOrder(order.id, {
      status: OrderStatus.CANCELLED,
      notes: order.notes
        ? `${order.notes}\nRestarted from the grounded tool layer.`
        : 'Restarted from the grounded tool layer.',
    });

    return {
      name: 'restart_order_session',
      ok: true,
      summary: `Cancelled mutable draft order ${order.orderNumber} for a restart.`,
      replyHint: 'Understood. I have cleared the current draft. Tell me the size and quantity you want, and I will guide you.',
      data: {
        orderId: order.id,
      },
    };
  }

  private async confirmOrder(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const order = await getLatestConversationOrder(context.conversationId);

    if (!order) {
      return {
        name: 'confirm_order',
        ok: false,
        summary: 'No order is available to confirm.',
      };
    }

    if (order.paymentStatus !== PaymentStatus.VERIFIED) {
      return {
        name: 'confirm_order',
        ok: false,
        summary: `Order ${order.orderNumber} cannot be confirmed before verified payment.`,
      };
    }

    const updated = await updateOrder(order.id, {
      status: OrderStatus.CONFIRMED,
    });

    return {
      name: 'confirm_order',
      ok: true,
      summary: `Confirmed order ${updated.orderNumber}.`,
      replyHint: 'Your order is confirmed. If you want help with anything else, I can guide you.',
      data: {
        orderId: updated.id,
      },
    };
  }

  private async markPaymentSubmitted(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const order = await getLatestConversationOrder(context.conversationId);
    const reference = typeof args.reference === 'string' ? args.reference : context.latestUserMessage;

    if (!order) {
      return {
        name: 'mark_payment_submitted',
        ok: false,
        summary: 'No order is available to mark payment on.',
      };
    }

    if (order.paymentStatus === PaymentStatus.SUBMITTED || order.paymentStatus === PaymentStatus.VERIFIED) {
      return {
        name: 'mark_payment_submitted',
        ok: true,
        summary: `Payment for ${order.orderNumber} is already ${order.paymentStatus}.`,
        replyHint: `Your payment is already marked as ${formatPaymentStatus(order.paymentStatus)}.`,
      };
    }

    await createPayment({
      orderId: order.id,
      amount: order.totalAmount,
      method: PaymentMethod.UPI,
      status: PaymentStatus.SUBMITTED,
      reference,
    });

    return {
      name: 'mark_payment_submitted',
      ok: true,
      summary: `Marked payment as submitted for ${order.orderNumber}.`,
      replyHint: 'I have marked the payment as submitted. It will now move through verification.',
      data: {
        orderId: order.id,
      },
    };
  }

  private async verifyPayment(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const currentOrder = await getLatestConversationOrder(context.conversationId);
    const payments = await listPayments({
      orderId: currentOrder?.id,
      limit: 1,
    });
    const latestPayment = payments[0];

    if (!latestPayment) {
      return {
        name: 'verify_payment',
        ok: false,
        summary: 'No payment record is available to verify.',
      };
    }

    const result = await updatePayment(latestPayment.id, {
      status: PaymentStatus.VERIFIED,
      reference: typeof args.reference === 'string' ? args.reference : latestPayment.reference,
    });

    return {
      name: 'verify_payment',
      ok: true,
      summary: `Verified payment for order ${result.order.id}.`,
      replyHint: 'Payment has been verified successfully.',
      data: {
        orderId: result.order.id,
      },
    };
  }

  private async updateCustomerMemory(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const prisma = getPrismaClient();
    const existing = await prisma.customerMemory.findUnique({
      where: {
        customerId: context.customerId,
      },
    });
    const patch = asRecord(args.profilePatch) ?? {};
    const currentProfile = asRecord(existing?.profileJson) ?? {};
    const updatedProfile = {
      ...currentProfile,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await prisma.customerMemory.upsert({
      where: {
        customerId: context.customerId,
      },
      create: {
        customerId: context.customerId,
        profileJson: updatedProfile as Prisma.InputJsonValue,
        salesJson: existing?.salesJson ?? undefined,
        vipScore: existing?.vipScore ?? 0,
        lastSummary: existing?.lastSummary ?? null,
      },
      update: {
        profileJson: updatedProfile as Prisma.InputJsonValue,
      },
    });

    return {
      name: 'update_customer_memory',
      ok: true,
      summary: 'Customer memory was updated.',
      data: {
        profile: updatedProfile,
      },
    };
  }

  private async scheduleFollowUp(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const scheduledAt =
      typeof args.scheduledAt === 'string' && args.scheduledAt
        ? new Date(args.scheduledAt)
        : new Date(Date.now() + 6 * 60 * 60 * 1000);
    const reason =
      typeof args.reason === 'string' && args.reason.trim()
        ? args.reason.trim()
        : 'Scheduled from grounded tool layer.';

    const followUp = await scheduleFollowUp({
      leadId: context.leadId,
      conversationId: context.conversationId,
      type: 'DETAILS_PENDING',
      reason,
      suggestedMessage:
        typeof args.suggestedMessage === 'string' ? args.suggestedMessage : undefined,
      scheduledAt,
    });

    return {
      name: 'schedule_followup',
      ok: true,
      summary: `Scheduled follow-up ${followUp.id} for ${followUp.scheduledAt.toISOString()}.`,
      data: {
        followUpId: followUp.id,
      },
    };
  }

  private async escalateToHuman(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const prisma = getPrismaClient();
    const rawType = typeof args.type === 'string' ? args.type.trim() : 'LOW_CONFIDENCE';
    const type = rawType in EscalationType
      ? EscalationType[rawType as keyof typeof EscalationType]
      : EscalationType.LOW_CONFIDENCE;
    const reason =
      typeof args.reason === 'string' && args.reason.trim()
        ? args.reason.trim()
        : 'Escalated from grounded tool layer.';
    const existing = await prisma.escalation.findFirst({
      where: {
        leadId: context.leadId,
        type,
        status: {
          in: [EscalationStatus.OPEN, EscalationStatus.IN_REVIEW],
        },
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return {
        name: 'escalate_to_human',
        ok: true,
        summary: `Escalation ${existing.id} is already open.`,
        replyHint: 'I am moving this to a human team member for closer support.',
      };
    }

    const escalation = await createEscalation({
      leadId: context.leadId,
      conversationId: context.conversationId,
      customerId: context.customerId,
      type,
      severity: EscalationSeverity.MEDIUM,
      reason,
    });

    return {
      name: 'escalate_to_human',
      ok: true,
      summary: `Created escalation ${escalation.id} of type ${escalation.type}.`,
      replyHint: 'I am moving this to a human team member for closer support.',
      data: {
        escalationId: escalation.id,
      },
    };
  }

  private async searchKnowledge(
    domain: 'mango' | 'business',
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const query =
      typeof args.query === 'string' && args.query.trim()
        ? args.query
        : context.latestUserMessage;
    const articles =
      domain === 'mango'
        ? searchMangoKnowledge(query, 3)
        : searchBusinessKnowledge(query, 3);
    const topArticle = articles[0];

    return {
      name: domain === 'mango' ? 'search_mango_knowledge' : 'search_business_knowledge',
      ok: articles.length > 0,
      summary: summarizeKnowledgeResults(articles).join(' '),
      replyHint: topArticle?.customerReply,
      data: {
        articles: articles.map((article) => ({
          id: article.id,
          title: article.title,
          category: article.category,
        })),
      },
    };
  }
}

export const toolExecutorService = new ToolExecutorService();
