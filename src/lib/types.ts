export type ConversationMode = "agent" | "human";

export interface InteractiveButton {
  id: string;
  title: string;
}

export type SalesReply = {
  text: string;
  buttons?: InteractiveButton[];
};

export type SalesState =
  | "new"
  | "browsing"
  | "awaiting_quantity"
  | "awaiting_name"
  | "awaiting_address"
  | "awaiting_date"
  | "awaiting_confirmation"
  | "confirmed"
  | "human_handoff"
  | "lost";

export type LeadTag =
  | "cold"
  | "warm"
  | "hot"
  | "price_seeker"
  | "gift_lead"
  | "corporate_lead"
  | "subscription_lead"
  | "repeat_customer"
  | "human_required"
  | null;

export type CustomerIntent =
  | "price"
  | "delivery"
  | "quality_trust"
  | "gift"
  | "corporate"
  | "subscription"
  | "visit_store"
  | "ready_to_buy"
  | "confused"
  | "human_support"
  | null;

export interface Conversation {
  id: string;
  phone: string;
  name: string | null;
  mode: ConversationMode;
  updated_at: string;
  created_at: string;
  sales_state: SalesState;
  lead_tag: LeadTag;
  last_customer_intent: CustomerIntent;
  follow_up_count?: number | null;
  last_follow_up_sent_at?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  whatsapp_msg_id: string | null;
  created_at: string;
}

export interface ConversationWithLastMessage extends Conversation {
  last_message: string | null;
}

export type ProductSize = "medium" | "large" | "jumbo";
export type OrderType = "personal" | "gift" | "corporate" | "subscription";
export type OrderStatus = "draft" | "awaiting_confirmation" | "confirmed" | "cancelled";

export interface Order {
  id: string;
  conversation_id: string;
  customer_name: string | null;
  phone: string;
  product_size: ProductSize | null;
  quantity: number | null;
  delivery_address: string | null;
  delivery_date: string | null;
  order_type: OrderType;
  status: OrderStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type FollowUpStatus = "pending" | "sent" | "cancelled";

export interface FollowUp {
  id: string;
  conversation_id: string;
  phone: string;
  message: string;
  status: FollowUpStatus;
  scheduled_for: string;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookLog {
  id: string;
  whatsapp_msg_id: string | null;
  phone: string | null;
  status: string;
  payload: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export type FilterKey =
  | "all"
  | "hot"
  | "draft_orders"
  | "abandoned"
  | "confirmed"
  | "human_handoff"
  | "corporate"
  | "logs";
