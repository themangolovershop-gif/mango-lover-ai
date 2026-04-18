import {
  BuyerType,
  EscalationSeverity,
  EscalationType,
  LeadStage,
  LeadTemperature,
  ProductSize,
  type Order,
} from '@prisma/client';

import type { IntentType } from '@/backend/modules/ai/intent.service';
import type { NextAction } from '@/backend/modules/ai/nba.service';
import type { BuyerType as DetectedBuyerType } from '@/backend/modules/leads/buyer-type.service';
import type { LeadStage as DerivedLeadStage } from '@/backend/modules/leads/stage.service';

export function mapBuyerTypeToPrisma(buyerType: DetectedBuyerType) {
  return BuyerType[buyerType];
}

export function mapLeadStageToPrisma(stage: DerivedLeadStage) {
  return LeadStage[stage];
}

export function mapLeadTemperatureToPrisma(temperature: 'COLD' | 'WARM' | 'HOT') {
  return LeadTemperature[temperature];
}

type OrderSummaryItem = {
  quantity: number;
  product?: {
    size: ProductSize;
  } | null;
};

type OrderSummarySource = (Order & {
  items?: OrderSummaryItem[];
}) | null;

function formatProductSize(size?: ProductSize) {
  return size ? size.toLowerCase() : 'selected';
}

function formatItemSummary(order: OrderSummarySource) {
  const firstItem = order?.items?.[0];

  if (!firstItem) {
    return null;
  }

  const size = formatProductSize(firstItem.product?.size);
  const quantityLabel = firstItem.quantity === 1 ? 'box' : 'boxes';
  return `${firstItem.quantity} ${size} ${quantityLabel}`;
}

export function buildOrderSummary(order: OrderSummarySource) {
  if (!order) {
    return undefined;
  }

  const itemSummary = formatItemSummary(order);
  const orderHeader = itemSummary
    ? `Current order ${order.orderNumber}: ${itemSummary}.`
    : `Order ${order.orderNumber}.`;

  return `${orderHeader} Status ${order.status}. Payment ${order.paymentStatus}. Total ${order.currency} ${order.totalAmount.toFixed(2)}.`;
}

export function determineEscalationPlan(args: {
  intents: IntentType[];
  buyerType: DetectedBuyerType;
  nextAction: NextAction;
}) {
  if (args.intents.includes('complaint')) {
    return {
      type: EscalationType.COMPLAINT,
      severity: EscalationSeverity.HIGH,
      reason: 'Customer reported a complaint in WhatsApp conversation.',
    };
  }

  if (args.intents.includes('refund')) {
    return {
      type: EscalationType.REFUND_REQUEST,
      severity: EscalationSeverity.HIGH,
      reason: 'Customer requested a refund in WhatsApp conversation.',
    };
  }

  if (args.nextAction === 'ESCALATE_HUMAN') {
    return {
      type: EscalationType.LOW_CONFIDENCE,
      severity: EscalationSeverity.MEDIUM,
      reason: 'Conversation requires human assistance.',
    };
  }

  if (args.buyerType === 'BULK') {
    return {
      type: EscalationType.BULK_ORDER,
      severity: EscalationSeverity.MEDIUM,
      reason: 'Potential bulk order detected.',
    };
  }

  return null;
}

export function determineFollowUpPlan(args: {
  leadStage: DerivedLeadStage;
  nextAction: NextAction;
  needsHuman: boolean;
}) {
  if (args.needsHuman) {
    return null;
  }

  if (args.nextAction === 'REQUEST_PAYMENT') {
    return {
      type: 'PAYMENT_PENDING' as const,
      reason: 'Awaiting payment confirmation from customer.',
      delayHours: 6,
    };
  }

  if (
    args.nextAction === 'COLLECT_ADDRESS' ||
    args.nextAction === 'COLLECT_QUANTITY_AND_CITY' ||
    args.nextAction === 'RECOMMEND_PRODUCT'
  ) {
    return {
      type: 'DETAILS_PENDING' as const,
      reason: 'Awaiting additional order details from customer.',
      delayHours: 6,
    };
  }

  if (args.leadStage === 'CONFIRMED') {
    return {
      type: 'REPEAT_REACTIVATION' as const,
      reason: 'Confirmed order completed; schedule reactivation follow-up.',
      delayHours: 120,
    };
  }

  return null;
}
