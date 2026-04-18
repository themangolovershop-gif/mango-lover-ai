import type { ProductSize } from "@/lib/types";

export type SalesIntent =
  | "greeting"
  | "pricing"
  | "product_selection"
  | "recommendation_request"
  | "quality_check"
  | "authenticity_check"
  | "delivery_check"
  | "availability_check"
  | "order_start"
  | "address_submission"
  | "payment_update"
  | "order_confirmation_request"
  | "discount_request"
  | "objection_price"
  | "gifting"
  | "bulk_order"
  | "corporate_order"
  | "repeat_order"
  | "complaint"
  | "refund"
  | "cancellation"
  | "restart_order_request"
  | "reset_conversation"
  | "edit_order_request"
  | "gratitude"
  | "out_of_scope"
  | "human_help_request";

export type LeadStage =
  | "new_inquiry"
  | "engaged"
  | "qualified"
  | "product_recommended"
  | "objection_price"
  | "objection_quality"
  | "awaiting_details"
  | "awaiting_payment"
  | "payment_submitted"
  | "order_confirmed"
  | "dispatched"
  | "delivered"
  | "repeat_customer"
  | "complaint_open"
  | "escalated"
  | "cold"
  | "lost";

export type BuyerType =
  | "personal"
  | "gifting"
  | "repeat"
  | "corporate"
  | "reseller"
  | "wholesale"
  | "uncertain";

export type LeadTemperature = "cold" | "warm" | "hot";

export type QuantityUnit =
  | "box"
  | "boxes"
  | "dozen"
  | "peti"
  | "crate"
  | "unit"
  | "unknown";

export type EscalationType =
  | "bulk_order"
  | "corporate_order"
  | "wholesale_inquiry"
  | "complaint"
  | "refund"
  | "payment_conflict"
  | "vip_order"
  | "logistics"
  | "low_confidence"
  | "human_request";

export type EscalationSeverity = "low" | "medium" | "high";

export type LanguageStyle = "english" | "hinglish" | "broken_english";

export interface QuantityEntity {
  value: number;
  unit: QuantityUnit;
  confidence: number;
}

export interface AddressEntity {
  raw: string;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  landmark: string | null;
  confidence: number;
}

export interface CustomerEntities {
  customerName: string | null;
  productSize: ProductSize | null;
  quantity: QuantityEntity | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  address: AddressEntity | null;
  giftingIntent: boolean;
  corporateIntent: boolean;
  repeatIntent: boolean;
  urgency: "normal" | "urgent" | "tomorrow";
  paymentMentioned: boolean;
  paymentStatus: "unknown" | "submitted";
  complaintType: string | null;
}

export interface LeadScoreFactor {
  label: string;
  weight: number;
  reason: string;
}

export interface SalesEscalationDecision {
  recommended: boolean;
  type: EscalationType | null;
  severity: EscalationSeverity | null;
  reason: string | null;
  autoHandoff: boolean;
}

export interface CustomerMessageAnalysis {
  rawText: string;
  normalizedText: string;
  intents: SalesIntent[];
  primaryIntent: SalesIntent;
  languageStyle: LanguageStyle;
  entities: CustomerEntities;
  leadStage: LeadStage;
  buyerType: BuyerType;
  temperature: LeadTemperature;
  score: number;
  scoreBreakdown: LeadScoreFactor[];
  escalation: SalesEscalationDecision;
  confidence: number;
}

export interface WhatsAppProviderAdapter {
  providerName: string;
  sendTextMessage(input: {
    to: string;
    body: string;
    buttons?: Array<{ id: string; title: string }>;
  }): Promise<{ providerMessageId: string | null }>;
}

export interface MessageIngestionService {
  normalizeInboundMessage(rawText: string): CustomerMessageAnalysis;
}

export interface CRMService {
  upsertLeadSnapshot(input: {
    phone: string;
    customerName?: string | null;
    analysis: CustomerMessageAnalysis;
  }): Promise<void>;
}

export interface OrderServiceContract {
  syncDraftOrder(input: {
    phone: string;
    analysis: CustomerMessageAnalysis;
  }): Promise<void>;
}

export interface PaymentServiceContract {
  registerManualPaymentSignal(input: {
    phone: string;
    amount?: number | null;
    referenceText: string;
  }): Promise<void>;
}

export interface FollowUpServiceContract {
  scheduleRecovery(input: {
    phone: string;
    reason: string;
    scheduledAt: string;
  }): Promise<void>;
}

export const PLATFORM_MODULES = [
  "whatsapp-webhook-service",
  "message-ingestion-service",
  "intent-classification-service",
  "entity-extraction-service",
  "conversation-state-service",
  "reply-generation-service",
  "crm-service",
  "order-service",
  "payment-service",
  "followup-service",
  "human-escalation-service",
  "admin-dashboard",
  "audit-log-service",
  "analytics-service",
] as const;
