import {
  BuyerType,
  FollowUpStatus,
  PaymentStatus,
  ProductSize,
  Prisma,
  type MessageDirection,
  type MessageSender,
} from '@prisma/client';

import type { IntentType } from '@/backend/modules/ai/intent.service';
import type { NextAction } from '@/backend/modules/ai/nba.service';
import type { getLatestConversationOrder } from '@/backend/modules/orders/order.service';
import { buildOrderSummary } from '@/backend/modules/whatsapp/message-orchestrator.helpers';
import { logger } from '@/backend/shared/lib/logger';
import { getPrismaClient } from '@/backend/shared/lib/prisma';
import { normalizeMessage } from '@/backend/shared/utils/normalization';

import type {
  CustomerMemoryProfile,
  FollowUpPerformance,
  LeadScoreTrend,
  MemoryBuyerType,
  MemoryContextSnapshot,
  MemoryLanguage,
  MemorySize,
  PaymentBehavior,
  PersonalizationContext,
  PreferredContactStyle,
  SalesMemoryState,
  SessionMemoryState,
} from './types';

type ConversationOrder = Awaited<ReturnType<typeof getLatestConversationOrder>>;

type HistoricalMessage = {
  rawText: string;
  direction: MessageDirection;
  sentBy: MessageSender;
  createdAt: Date;
  conversationId: string;
};

type HistoricalFollowUp = {
  status: FollowUpStatus;
  reason: string;
  type: string;
};

type ExistingMemorySnapshot = {
  profile?: Partial<CustomerMemoryProfile>;
  sales?: Partial<SalesMemoryState>;
  session?: Partial<SessionMemoryState>;
};

type MessageSignalCounts = {
  priceQueries: number;
  priceObjections: number;
  recommendation: number;
  delivery: number;
  trust: number;
  gifting: number;
  bulk: number;
  orderSummary: number;
  humanHelp: number;
  payment: number;
};

type SyncMemoryInput = {
  customerId: string;
  conversationId: string;
  customerName?: string;
  phone: string;
  leadStage: string;
  buyerType: string;
  leadScore: number;
  intents: IntentType[];
  nextAction: NextAction;
  latestOrder: ConversationOrder | null;
  latestUserMessage?: string;
  lastAssistantReply?: string;
};

const PRICE_QUERY_PATTERNS = ['price', 'rate', 'cost', 'kitna', 'bhav', 'how much'];
const PRICE_OBJECTION_PATTERNS = ['expensive', 'discount', 'cheaper', 'last price', 'costly', 'too much'];
const RECOMMENDATION_PATTERNS = ['which', 'best', 'recommend', 'suggest'];
const DELIVERY_PATTERNS = ['delivery', 'courier', 'shipping', 'reach', 'when'];
const TRUST_PATTERNS = ['sweet', 'quality', 'fresh', 'authentic', 'original', 'gi', 'carbide'];
const GIFTING_PATTERNS = ['gift', 'birthday', 'anniversary', 'presentation'];
const BULK_PATTERNS = ['bulk', 'wholesale', 'corporate', 'boxes', 'large quantity'];
const SUMMARY_PATTERNS = ['what did i order', 'order details', 'show summary', 'show details'];
const HUMAN_HELP_PATTERNS = ['human', 'agent', 'support', 'call'];
const PAYMENT_PATTERNS = ['payment', 'paid', 'transfer', 'screenshot', 'reference'];
const HINDI_PATTERNS = ['hai', 'haan', 'nahi', 'kitna', 'bhai', 'ji', 'chahiye', 'kal'];

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function getStoredSnapshot(args: {
  customerMemory?: { profileJson: Prisma.JsonValue; salesJson: Prisma.JsonValue | null } | null;
  sessionMemory?: { stateJson: Prisma.JsonValue } | null;
}): ExistingMemorySnapshot {
  return {
    profile: (toRecord(args.customerMemory?.profileJson) as Partial<CustomerMemoryProfile>) ?? {},
    sales: (toRecord(args.customerMemory?.salesJson) as Partial<SalesMemoryState>) ?? {},
    session: (toRecord(args.sessionMemory?.stateJson) as Partial<SessionMemoryState>) ?? {},
  };
}

function hasPattern(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function formatAddress(address?: {
  line1: string;
  line2: string | null;
  area: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pinCode: string;
} | null) {
  if (!address) {
    return undefined;
  }

  return [
    address.line1,
    address.line2 ?? undefined,
    address.area ?? undefined,
    address.landmark ?? undefined,
    titleCase(address.city),
    titleCase(address.state),
    address.pinCode,
  ]
    .filter(Boolean)
    .join(', ');
}

function mapBuyerTypeToMemory(value?: string | null): MemoryBuyerType | undefined {
  switch (value) {
    case BuyerType.PERSONAL:
    case 'PERSONAL':
      return 'personal';
    case BuyerType.GIFTING:
    case 'GIFTING':
      return 'gifting';
    case BuyerType.BULK:
    case 'BULK':
      return 'bulk';
    case BuyerType.REPEAT:
    case 'REPEAT':
      return 'repeat';
    default:
      return undefined;
  }
}

function mapProductSizeToMemory(value?: ProductSize | null): MemorySize | undefined {
  switch (value) {
    case ProductSize.MEDIUM:
      return 'medium';
    case ProductSize.LARGE:
      return 'large';
    case ProductSize.JUMBO:
      return 'jumbo';
    default:
      return undefined;
  }
}

function formatSize(size?: MemorySize) {
  return size ? titleCase(size) : undefined;
}

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }

  return Number(value.toString());
}

function getOrderQuantity(order: {
  items: Array<{
    quantity: number;
  }>;
}) {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

function getLeadScoreTrend(currentLeadScore: number, previousLeadScore?: number): LeadScoreTrend {
  if (previousLeadScore === undefined) {
    return 'stable';
  }

  if (currentLeadScore >= previousLeadScore + 10) {
    return 'rising';
  }

  if (currentLeadScore <= previousLeadScore - 10) {
    return 'cooling';
  }

  return 'stable';
}

function getFollowUpPerformance(followUps: HistoricalFollowUp[]): FollowUpPerformance {
  if (followUps.length === 0) {
    return 'unknown';
  }

  const sentCount = followUps.filter((followUp) => followUp.status === FollowUpStatus.SENT).length;
  const successRatio = sentCount / followUps.length;

  if (successRatio >= 0.6) {
    return 'strong';
  }

  if (successRatio >= 0.25) {
    return 'mixed';
  }

  return 'weak';
}

function inferPreferredLanguage(args: {
  storedValue?: CustomerMemoryProfile['preferredLanguage'];
  customerPreferredLanguage?: string | null;
  messages: HistoricalMessage[];
}): MemoryLanguage | undefined {
  if (args.storedValue) {
    return args.storedValue;
  }

  const explicit = args.customerPreferredLanguage?.trim().toLowerCase();

  if (explicit === 'english' || explicit === 'hinglish' || explicit === 'hindi' || explicit === 'mixed') {
    return explicit;
  }

  const inboundMessages = args.messages.filter((message) => message.direction === 'INBOUND');
  const normalizedMessages = inboundMessages.map((message) => normalizeMessage(message.rawText));
  const hindiSignals = normalizedMessages.filter((text) => hasPattern(text, HINDI_PATTERNS)).length;

  if (hindiSignals >= 3 && normalizedMessages.length > 0) {
    return 'hinglish';
  }

  if (normalizedMessages.length > 0) {
    return 'english';
  }

  return undefined;
}

function collectMessageSignals(messages: HistoricalMessage[]) {
  return messages
    .filter((message) => message.direction === 'INBOUND')
    .reduce<MessageSignalCounts>(
      (signals, message) => {
        const normalized = normalizeMessage(message.rawText);

        if (hasPattern(normalized, PRICE_QUERY_PATTERNS)) {
          signals.priceQueries += 1;
        }

        if (hasPattern(normalized, PRICE_OBJECTION_PATTERNS)) {
          signals.priceObjections += 1;
        }

        if (hasPattern(normalized, RECOMMENDATION_PATTERNS)) {
          signals.recommendation += 1;
        }

        if (hasPattern(normalized, DELIVERY_PATTERNS)) {
          signals.delivery += 1;
        }

        if (hasPattern(normalized, TRUST_PATTERNS)) {
          signals.trust += 1;
        }

        if (hasPattern(normalized, GIFTING_PATTERNS)) {
          signals.gifting += 1;
        }

        if (hasPattern(normalized, BULK_PATTERNS)) {
          signals.bulk += 1;
        }

        if (hasPattern(normalized, SUMMARY_PATTERNS)) {
          signals.orderSummary += 1;
        }

        if (hasPattern(normalized, HUMAN_HELP_PATTERNS)) {
          signals.humanHelp += 1;
        }

        if (hasPattern(normalized, PAYMENT_PATTERNS)) {
          signals.payment += 1;
        }

        return signals;
      },
      {
        priceQueries: 0,
        priceObjections: 0,
        recommendation: 0,
        delivery: 0,
        trust: 0,
        gifting: 0,
        bulk: 0,
        orderSummary: 0,
        humanHelp: 0,
        payment: 0,
      }
    );
}

function getAverageInboundWordCount(messages: HistoricalMessage[]) {
  const inboundMessages = messages.filter((message) => message.direction === 'INBOUND');

  if (inboundMessages.length === 0) {
    return undefined;
  }

  const totalWords = inboundMessages.reduce((sum, message) => {
    return sum + message.rawText.trim().split(/\s+/).filter(Boolean).length;
  }, 0);

  return totalWords / inboundMessages.length;
}

function getPaymentBehavior(args: {
  successfulOrders: Array<{
    createdAt: Date;
    paymentStatus: PaymentStatus;
    payments: Array<{
      paidAt: Date | null;
      status: PaymentStatus;
    }>;
  }>;
  usuallyPaysFast?: boolean;
}): PaymentBehavior {
  if (args.usuallyPaysFast) {
    return 'fast';
  }

  const ordersWithVerifiedPayment = args.successfulOrders.filter((order) =>
    order.payments.some((payment) => payment.status === PaymentStatus.VERIFIED || payment.status === PaymentStatus.SUBMITTED)
  );

  if (ordersWithVerifiedPayment.length === 0) {
    return 'unknown';
  }

  const fastOrderCount = ordersWithVerifiedPayment.filter((order) => {
    const earliestPaidAt = order.payments
      .map((payment) => payment.paidAt)
      .filter((paidAt): paidAt is Date => paidAt instanceof Date)
      .sort((left, right) => left.getTime() - right.getTime())[0];

    if (!earliestPaidAt) {
      return false;
    }

    return earliestPaidAt.getTime() - order.createdAt.getTime() <= 24 * 60 * 60 * 1000;
  }).length;

  if (fastOrderCount === 0) {
    return 'slow';
  }

  if (fastOrderCount === ordersWithVerifiedPayment.length) {
    return 'steady';
  }

  return 'steady';
}

export function getVipScore(profile: CustomerMemoryProfile): number {
  let score = 0;

  if (profile.repeatCustomer) score += 25;
  if ((profile.averageQuantityDozen ?? 0) >= 3) score += 20;
  if (profile.usuallyPaysFast) score += 15;
  if (profile.buyerType === 'gifting') score += 10;
  if ((profile.lastOrderValue ?? 0) >= 5000) score += 20;
  if (profile.buyerType === 'bulk') score += 10;

  return Math.min(score, 100);
}

export function buildPersonalizationContext(profile: CustomerMemoryProfile): PersonalizationContext {
  const vipScore = getVipScore(profile);
  const reorderSize = profile.lastOrderSize ?? profile.preferredSize;
  const quantity = profile.lastOrderQuantityDozen ?? profile.averageQuantityDozen;
  const reorderHint =
    profile.repeatCustomer && reorderSize
      ? [
          'Welcome back. I can arrange your previous',
          formatSize(reorderSize),
          'selection again',
          profile.city ? `for ${titleCase(profile.city)} delivery` : '',
          quantity ? `with ${quantity} dozen` : '',
        ]
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\s\./g, '.')
          .concat('.')
      : undefined;

  return {
    isRepeat: profile.repeatCustomer,
    isVip: vipScore >= 70,
    vipScore,
    preferredSize: profile.preferredSize ?? profile.lastOrderSize,
    buyerType: profile.buyerType,
    priceSensitive: profile.priceSensitive,
    shouldUseShortReplies: profile.prefersShortReplies ?? true,
    likelyNeedsRecommendation: profile.prefersRecommendations ?? true,
    usuallyPaysFast: profile.usuallyPaysFast ?? false,
    reorderHint,
    preferredContactStyle: profile.preferredContactStyle,
  };
}

function buildPendingClarification(args: {
  nextAction: NextAction;
  latestOrder: ConversationOrder | null;
}) {
  switch (args.nextAction) {
    case 'COLLECT_QUANTITY_AND_CITY':
      return 'Need quantity and delivery city.';
    case 'COLLECT_ADDRESS':
      return 'Need full delivery address.';
    case 'REQUEST_PAYMENT':
      return args.latestOrder ? 'Awaiting payment confirmation.' : 'Awaiting payment step.';
    default:
      return undefined;
  }
}

function buildSessionMemory(args: {
  intents: IntentType[];
  nextAction: NextAction;
  latestOrder: ConversationOrder | null;
  existingSession?: Partial<SessionMemoryState>;
}): SessionMemoryState {
  const restartRequested =
    args.intents.includes('restart_order_request') || args.intents.includes('cancellation');
  const currentDraftSummary = buildOrderSummary(args.latestOrder) ?? undefined;
  const latestUserIntent = args.intents[0];

  let repeatGuardState: SessionMemoryState['repeatGuardState'] = 'clear';

  if (restartRequested || args.intents.includes('edit_order_request') || args.intents.includes('order_summary_request')) {
    repeatGuardState = 'break';
  } else if (args.existingSession?.lastBotAction === args.nextAction) {
    repeatGuardState = 'watch';
  }

  return {
    latestUserIntent,
    pendingClarification: buildPendingClarification({
      nextAction: args.nextAction,
      latestOrder: args.latestOrder,
    }),
    repeatGuardState,
    currentDraftSummary,
    restartRequested,
    lastBotAction: args.nextAction,
    orderEditContext: args.intents.includes('edit_order_request')
      ? currentDraftSummary
        ? 'Customer wants to modify the current order.'
        : 'Customer requested an order change but there is no active order yet.'
      : undefined,
  };
}

function buildCommonQuestions(signals: MessageSignalCounts) {
  const entries = [
    ['pricing', signals.priceQueries + signals.priceObjections],
    ['recommendation', signals.recommendation],
    ['delivery', signals.delivery],
    ['quality', signals.trust],
    ['payment', signals.payment],
  ] as const;

  return entries
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([label]) => label);
}

function buildProfileNotes(profile: CustomerMemoryProfile) {
  const notes = [
    profile.repeatCustomer ? 'Repeat buyer' : undefined,
    profile.buyerType === 'gifting' ? 'Frequently buys for gifting' : undefined,
    profile.priceSensitive ? 'Often asks about price or discounts' : undefined,
    profile.prefersRecommendations ? 'Usually asks for recommendations' : undefined,
    profile.usuallyPaysFast ? 'Usually pays quickly' : undefined,
    profile.asksDeliveryOften ? 'Often asks about delivery timing' : undefined,
  ].filter((note): note is string => Boolean(note));

  return notes.slice(0, 4);
}

export function buildConversationSummary(args: {
  profile: CustomerMemoryProfile;
  personalization: PersonalizationContext;
  sales: SalesMemoryState;
  session: SessionMemoryState;
}) {
  const segments = [
    `Customer is ${args.profile.name ?? 'the customer'}${args.profile.city ? ` from ${titleCase(args.profile.city)}` : ''}.`,
    args.personalization.isVip
      ? 'VIP repeat buyer.'
      : args.profile.repeatCustomer
        ? 'Repeat buyer.'
        : 'New or low-history buyer.',
    args.profile.preferredSize ? `Usually prefers ${formatSize(args.profile.preferredSize)}.` : undefined,
    args.session.currentDraftSummary ? `Current draft: ${args.session.currentDraftSummary}` : undefined,
    args.profile.priceSensitive ? 'Value-focused buyer; avoid over-selling premium positioning.' : undefined,
    args.profile.prefersRecommendations ? 'Usually responds well to clear recommendations.' : undefined,
    args.session.restartRequested ? 'Customer asked to restart the order.' : undefined,
    args.session.repeatGuardState === 'watch' ? 'Avoid repeating the same action verbatim.' : undefined,
    args.sales.paymentBehavior === 'fast' ? 'Usually pays quickly once ready.' : undefined,
  ].filter((segment): segment is string => Boolean(segment));

  return segments.join(' ');
}

export function buildPersonalizedFollowUpMessage(args: {
  followUpType: string;
  profile: CustomerMemoryProfile;
  personalization: PersonalizationContext;
  session: SessionMemoryState;
}) {
  if (args.followUpType === 'REPEAT_REACTIVATION') {
    if (args.personalization.reorderHint) {
      return `${args.personalization.reorderHint} Let me know if you want the same quantity or any change.`;
    }

    if (args.profile.buyerType === 'gifting') {
      return 'Our premium gifting selection is available in the current batch. If you want, I can recommend the most suitable option for gifting.';
    }

    if (args.profile.priceSensitive) {
      return 'The current batch is available, and I can suggest the most suitable selection based on your requirement and budget.';
    }

    return 'Your preferred selection is available again this week. If you want, I can help you place the next order quickly.';
  }

  if (args.followUpType === 'DETAILS_PENDING') {
    if (args.personalization.reorderHint) {
      return `${args.personalization.reorderHint} Tell me the city or any change you want, and I will prepare it.`;
    }

    if (args.profile.buyerType === 'gifting') {
      return 'For gifting, Jumbo is usually preferred for presentation and size. Share your quantity and delivery city, and I will guide you.';
    }

    if (args.profile.priceSensitive) {
      return 'I can suggest the most suitable option based on your requirement and budget. Share your quantity and city, and I will guide you.';
    }

    return 'Your selection is still open. Share your quantity and delivery city, and I will help you with the next step.';
  }

  if (args.followUpType === 'PAYMENT_PENDING') {
    if (args.session.currentDraftSummary) {
      return `${args.session.currentDraftSummary} Share the payment update when ready, or tell me if you want to change anything first.`;
    }

    return 'Your selection is still open. Share the payment update when ready, and I will guide you with the next step.';
  }

  return 'Your selection is still open. Let me know if you would like to continue.';
}

export async function syncCustomerMemoryContext(input: SyncMemoryInput): Promise<MemoryContextSnapshot> {
  const prisma = getPrismaClient();

  const [customer, sessionMemory, messages, followUps] = await Promise.all([
    prisma.customer.findUnique({
      where: {
        id: input.customerId,
      },
      include: {
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        },
        orders: {
          include: {
            items: {
              include: {
                product: {
                  select: {
                    size: true,
                  },
                },
              },
            },
            payments: {
              select: {
                status: true,
                paidAt: true,
              },
            },
          },
          orderBy: {
            updatedAt: 'desc',
          },
          take: 25,
        },
        memory: {
          select: {
            profileJson: true,
            salesJson: true,
          },
        },
      },
    }),
    prisma.conversationMemory.findUnique({
      where: {
        conversationId: input.conversationId,
      },
      select: {
        stateJson: true,
      },
    }),
    prisma.message.findMany({
      where: {
        conversation: {
          customerId: input.customerId,
        },
      },
      select: {
        rawText: true,
        direction: true,
        sentBy: true,
        createdAt: true,
        conversationId: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 80,
    }),
    prisma.followUp.findMany({
      where: {
        lead: {
          customerId: input.customerId,
        },
      },
      select: {
        status: true,
        reason: true,
        type: true,
      },
      orderBy: {
        scheduledAt: 'desc',
      },
      take: 20,
    }),
  ]);

  if (!customer) {
    throw new Error(`Customer ${input.customerId} was not found while building memory context.`);
  }

  const storedSnapshot = getStoredSnapshot({
    customerMemory: customer.memory,
    sessionMemory,
  });
  const messageSignals = collectMessageSignals(messages);
  const successfulOrders = customer.orders.filter(
    (order) =>
      order.status === 'CONFIRMED' ||
      order.status === 'PACKED' ||
      order.status === 'DISPATCHED' ||
      order.status === 'DELIVERED' ||
      order.paymentStatus === PaymentStatus.VERIFIED
  );
  const preferredAddress = customer.addresses[0];
  const lastSuccessfulOrder = successfulOrders[0];
  const candidateOrders = successfulOrders.length > 0 ? successfulOrders : customer.orders;
  const quantities = candidateOrders.map((order) => getOrderQuantity(order)).filter((value) => value > 0);
  const averageQuantityDozen =
    quantities.length > 0
      ? Number((quantities.reduce((sum, value) => sum + value, 0) / quantities.length).toFixed(1))
      : storedSnapshot.profile?.averageQuantityDozen;
  const sizeCounts = candidateOrders.reduce<Record<MemorySize, number>>(
    (counts, order) => {
      order.items.forEach((item) => {
        const size = mapProductSizeToMemory(item.product.size);

        if (size) {
          counts[size] += 1;
        }
      });

      return counts;
    },
    {
      medium: 0,
      large: 0,
      jumbo: 0,
    }
  );
  const preferredSizeEntry = Object.entries(sizeCounts).sort((left, right) => right[1] - left[1])[0] as
    | [MemorySize, number]
    | undefined;
  const preferredSize =
    preferredSizeEntry && preferredSizeEntry[1] >= 2
      ? preferredSizeEntry[0]
      : storedSnapshot.profile?.preferredSize;
  const averageInboundWordCount = getAverageInboundWordCount(messages);
  const lastKnownAddress = formatAddress(preferredAddress) ?? storedSnapshot.profile?.lastKnownAddress;
  const repeatCustomer = customer.isRepeatBuyer || successfulOrders.length > 0;
  const priceSensitive =
    storedSnapshot.profile?.priceSensitive === true || messageSignals.priceObjections >= 1 || messageSignals.priceQueries >= 3;
  const prefersRecommendations =
    storedSnapshot.profile?.prefersRecommendations === true || messageSignals.recommendation >= 1;
  const asksDeliveryOften =
    storedSnapshot.profile?.asksDeliveryOften === true || messageSignals.delivery >= 2;
  const asksPriceFirstOften =
    storedSnapshot.profile?.asksPriceFirstOften === true || messageSignals.priceQueries >= 2;
  const usuallyPaysFast =
    storedSnapshot.profile?.usuallyPaysFast === true ||
    successfulOrders.some((order) => {
      const earliestPaidAt = order.payments
        .map((payment) => payment.paidAt)
        .filter((paidAt): paidAt is Date => paidAt instanceof Date)
        .sort((left, right) => left.getTime() - right.getTime())[0];

      if (!earliestPaidAt) {
        return false;
      }

      return earliestPaidAt.getTime() - order.createdAt.getTime() <= 24 * 60 * 60 * 1000;
    });
  const buyerType =
    messageSignals.bulk >= 2 || (averageQuantityDozen ?? 0) >= 5
      ? 'bulk'
      : messageSignals.gifting >= 1
        ? 'gifting'
        : repeatCustomer
          ? 'repeat'
          : mapBuyerTypeToMemory(input.buyerType) ?? storedSnapshot.profile?.buyerType;

  const profile: CustomerMemoryProfile = {
    customerId: customer.id,
    name: customer.name || input.customerName,
    phone: customer.phone || input.phone,
    city: customer.city ?? preferredAddress?.city ?? storedSnapshot.profile?.city,
    state: customer.state ?? preferredAddress?.state ?? storedSnapshot.profile?.state,
    preferredLanguage: inferPreferredLanguage({
      storedValue: storedSnapshot.profile?.preferredLanguage,
      customerPreferredLanguage: customer.preferredLanguage,
      messages,
    }),
    repeatCustomer,
    buyerType,
    preferredSize,
    averageQuantityDozen,
    priceSensitive,
    trustFocused: storedSnapshot.profile?.trustFocused === true || messageSignals.trust >= 2,
    prefersRecommendations,
    prefersShortReplies:
      storedSnapshot.profile?.prefersShortReplies ?? (averageInboundWordCount !== undefined ? averageInboundWordCount <= 7 : undefined),
    asksDeliveryOften,
    asksPriceFirstOften,
    usuallyPaysFast,
    lastOrderDate: lastSuccessfulOrder?.createdAt.toISOString(),
    lastOrderSize:
      mapProductSizeToMemory(lastSuccessfulOrder?.items[0]?.product.size) ??
      storedSnapshot.profile?.lastOrderSize,
    lastOrderQuantityDozen:
      (lastSuccessfulOrder ? getOrderQuantity(lastSuccessfulOrder) : undefined) ??
      storedSnapshot.profile?.lastOrderQuantityDozen,
    lastOrderValue:
      toNumber(lastSuccessfulOrder?.totalAmount) ?? storedSnapshot.profile?.lastOrderValue,
    lastKnownAddress,
    preferredContactStyle:
      storedSnapshot.profile?.preferredContactStyle ??
      (messageSignals.humanHelp >= 1 || buyerType === 'bulk'
        ? 'call'
        : messageSignals.orderSummary >= 1
          ? 'summary_first'
          : 'whatsapp'),
    notes: [],
    updatedAt: new Date().toISOString(),
  };

  profile.notes = buildProfileNotes(profile);

  const sales: SalesMemoryState = {
    currentLeadStage: input.leadStage,
    buyerType: profile.buyerType,
    leadScoreTrend: getLeadScoreTrend(input.leadScore, storedSnapshot.sales?.currentLeadScore),
    followUpSuccess: getFollowUpPerformance(followUps),
    objectionHistory: priceSensitive ? ['price'] : [],
    commonQuestions: buildCommonQuestions(messageSignals),
    lastQuoteGiven: toNumber(input.latestOrder?.totalAmount) ?? profile.lastOrderValue,
    paymentBehavior: getPaymentBehavior({
      successfulOrders,
      usuallyPaysFast: profile.usuallyPaysFast,
    }),
    lastKnownDeliveryCity: profile.city ? titleCase(profile.city) : undefined,
    lastOrderValue: profile.lastOrderValue,
    currentLeadScore: input.leadScore,
  };

  const session = buildSessionMemory({
    intents: input.intents,
    nextAction: input.nextAction,
    latestOrder: input.latestOrder,
    existingSession: storedSnapshot.session,
  });
  const personalization = buildPersonalizationContext(profile);
  const conversationSummary = buildConversationSummary({
    profile,
    personalization,
    sales,
    session,
  });

  try {
    await prisma.customerMemory.upsert({
      where: {
        customerId: customer.id,
      },
      create: {
        customerId: customer.id,
        profileJson: profile as Prisma.InputJsonValue,
        salesJson: sales as Prisma.InputJsonValue,
        vipScore: personalization.vipScore,
        lastSummary: conversationSummary,
      },
      update: {
        profileJson: profile as Prisma.InputJsonValue,
        salesJson: sales as Prisma.InputJsonValue,
        vipScore: personalization.vipScore,
        lastSummary: conversationSummary,
      },
    });

    await prisma.conversationMemory.upsert({
      where: {
        conversationId: input.conversationId,
      },
      create: {
        conversationId: input.conversationId,
        stateJson: session as Prisma.InputJsonValue,
        summary: conversationSummary,
      },
      update: {
        stateJson: session as Prisma.InputJsonValue,
        summary: conversationSummary,
      },
    });

    if (customer.isRepeatBuyer !== profile.repeatCustomer) {
      await prisma.customer.update({
        where: {
          id: customer.id,
        },
        data: {
          isRepeatBuyer: profile.repeatCustomer,
        },
      });
    }
  } catch (error) {
    logger.warn('memory.persistence.skipped', {
      customerId: customer.id,
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  return {
    profile,
    sales,
    session,
    personalization,
    conversationSummary,
  };
}
