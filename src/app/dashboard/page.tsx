"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversationWithLastMessage,
  FollowUp,
  Message,
  Order,
  ProductSize,
  SalesState,
} from "@/lib/types";

type FilterKey =
  | "all"
  | "hot"
  | "draft_orders"
  | "abandoned"
  | "confirmed"
  | "human_handoff"
  | "corporate";

const FUNNEL_STATES: SalesState[] = [
  "new",
  "browsing",
  "awaiting_quantity",
  "awaiting_name",
  "awaiting_address",
  "awaiting_date",
  "awaiting_confirmation",
  "confirmed",
  "human_handoff",
];

const CHECKOUT_STATES: SalesState[] = [
  "awaiting_quantity",
  "awaiting_name",
  "awaiting_address",
  "awaiting_date",
  "awaiting_confirmation",
];

const PRICE_BY_SIZE: Record<ProductSize, number> = {
  medium: 1499,
  large: 1999,
  jumbo: 2499,
};

const CONFIRM_KEYWORDS = ["confirm", "confirm order", "yes confirm", "book", "book order"];
const UPGRADE_KEYWORDS = ["upgrade", "add", "make it 2"];
const EDIT_KEYWORDS = ["edit order"];

async function readJsonResponse(res: Response) {
  const text = await res.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid server response");
  }
}

function badgeClass(type: string) {
  if (type === "agent") return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/20";
  if (type === "human") return "bg-amber-500/20 text-amber-300 border border-amber-500/20";
  if (type === "hot") return "bg-red-500/20 text-red-300 border border-red-500/20";
  if (type === "warm") return "bg-orange-500/20 text-orange-300 border border-orange-500/20";
  if (type === "price_seeker") return "bg-blue-500/20 text-blue-300 border border-blue-500/20";
  if (type === "gift_lead") return "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/20";
  if (type === "corporate_lead") return "bg-violet-500/20 text-violet-300 border border-violet-500/20";
  if (type === "subscription_lead") return "bg-cyan-500/20 text-cyan-300 border border-cyan-500/20";
  if (type === "human_required") return "bg-rose-500/20 text-rose-300 border border-rose-500/20";
  if (type === "confirmed") return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/20";
  if (type === "awaiting_confirmation") {
    return "bg-yellow-500/20 text-yellow-300 border border-yellow-500/20";
  }
  if (type === "draft") return "bg-white/10 text-white/70 border border-white/10";
  if (type === "pending") return "bg-yellow-500/20 text-yellow-300 border border-yellow-500/20";
  if (type === "sent") return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/20";
  if (type === "cancelled") return "bg-white/10 text-white/60 border border-white/10";
  return "bg-white/10 text-white/60 border border-white/10";
}

function labelize(value: string | null | undefined) {
  if (!value) return "-";
  return value.replaceAll("_", " ");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function estimateOrderValue(order: Order | null) {
  if (!order?.product_size || !order.quantity) return 0;

  let total = PRICE_BY_SIZE[order.product_size] * order.quantity;

  if (order.notes?.toLowerCase().includes("upsell accepted")) {
    total -= 200;
  }

  return Math.max(total, 0);
}

function formatRelativeTime(dateStr: string | null | undefined) {
  if (!dateStr) return "-";

  const diff = new Date(dateStr).getTime() - Date.now();
  const absMinutes = Math.max(1, Math.round(Math.abs(diff) / 60000));

  if (absMinutes < 60) {
    return diff >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  }

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return diff >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  }

  const absDays = Math.round(absHours / 24);
  return diff >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

function statePromptLabel(state: SalesState) {
  switch (state) {
    case "awaiting_quantity":
      return "Waiting for quantity";
    case "awaiting_name":
      return "Waiting for customer name";
    case "awaiting_address":
      return "Waiting for delivery address";
    case "awaiting_date":
      return "Waiting for delivery date";
    case "awaiting_confirmation":
      return "Ready for confirmation";
    default:
      return labelize(state);
  }
}

function getInitials(name: string | null, phone: string) {
  if (name) return name.slice(0, 2).toUpperCase();
  return phone.slice(-2);
}

function getSignalFlags(messages: Message[]) {
  const normalizedUserMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim().toLowerCase());

  const lastAction =
    [...normalizedUserMessages]
      .reverse()
      .find(
        (content) =>
          CONFIRM_KEYWORDS.includes(content) ||
          UPGRADE_KEYWORDS.some((keyword) => content.includes(keyword)) ||
          EDIT_KEYWORDS.some((keyword) => content.includes(keyword))
      ) || null;

  return {
    hasConfirm: normalizedUserMessages.some((content) => CONFIRM_KEYWORDS.includes(content)),
    hasUpgrade: normalizedUserMessages.some((content) =>
      UPGRADE_KEYWORDS.some((keyword) => content.includes(keyword))
    ),
    hasEdit: normalizedUserMessages.some((content) =>
      EDIT_KEYWORDS.some((keyword) => content.includes(keyword))
    ),
    lastAction,
  };
}

function MetricCard(props: {
  label: string;
  value: string;
  subtext: string;
  tone?: "emerald" | "blue" | "amber" | "rose" | "violet" | "neutral";
}) {
  const toneClass =
    props.tone === "emerald"
      ? "from-emerald-500/20 to-emerald-400/5 border-emerald-500/15"
      : props.tone === "blue"
        ? "from-blue-500/20 to-blue-400/5 border-blue-500/15"
        : props.tone === "amber"
          ? "from-amber-500/20 to-amber-400/5 border-amber-500/15"
          : props.tone === "rose"
            ? "from-rose-500/20 to-rose-400/5 border-rose-500/15"
            : props.tone === "violet"
              ? "from-violet-500/20 to-violet-400/5 border-violet-500/15"
              : "from-white/10 to-white/5 border-white/10";

  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${toneClass} p-4`}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{props.label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{props.value}</p>
      <p className="mt-1 text-xs text-white/45">{props.subtext}</p>
    </div>
  );
}

function SignalPill(props: { label: string; active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] ${
        props.active
          ? "border border-emerald-500/20 bg-emerald-500/15 text-emerald-300"
          : "border border-white/10 bg-white/5 text-white/45"
      }`}
    >
      {props.label}
    </span>
  );
}

export default function Dashboard() {
  const [conversations, setConversations] = useState<ConversationWithLastMessage[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [followUpMessage, setFollowUpMessage] = useState(
    "Hi, just checking in - would you like help reserving the right mango box today?"
  );
  const [followUpHours, setFollowUpHours] = useState("24");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || null,
    [conversations, selectedId]
  );

  const ordersByConversation = useMemo(() => {
    const map = new Map<string, Order>();

    for (const order of orders) {
      if (!map.has(order.conversation_id)) {
        map.set(order.conversation_id, order);
      }
    }

    return map;
  }, [orders]);

  const pendingFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.status === "pending"),
    [followUps]
  );

  const sentFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.status === "sent"),
    [followUps]
  );

  const cancelledFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.status === "cancelled"),
    [followUps]
  );

  const pendingFollowUpsByConversation = useMemo(() => {
    const map = new Map<string, FollowUp[]>();

    for (const followUp of pendingFollowUps) {
      const existing = map.get(followUp.conversation_id) || [];
      existing.push(followUp);
      map.set(followUp.conversation_id, existing);
    }

    return map;
  }, [pendingFollowUps]);

  const hotLeads = useMemo(
    () =>
      conversations
        .filter(
          (conversation) =>
            conversation.lead_tag === "hot" ||
            conversation.lead_tag === "corporate_lead" ||
            conversation.sales_state === "awaiting_confirmation"
        )
        .sort((left, right) => {
          const leftPriority = left.sales_state === "awaiting_confirmation" ? 1 : 0;
          const rightPriority = right.sales_state === "awaiting_confirmation" ? 1 : 0;

          if (leftPriority !== rightPriority) return rightPriority - leftPriority;

          const leftValue = estimateOrderValue(ordersByConversation.get(left.id) || null);
          const rightValue = estimateOrderValue(ordersByConversation.get(right.id) || null);
          if (leftValue !== rightValue) return rightValue - leftValue;

          return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
        }),
    [conversations, ordersByConversation]
  );

  const draftOrders = useMemo(
    () => orders.filter((order) => order.status === "draft" || order.status === "awaiting_confirmation"),
    [orders]
  );

  const confirmedOrders = useMemo(
    () => orders.filter((order) => order.status === "confirmed"),
    [orders]
  );

  const funnelMetrics = useMemo(() => {
    const counts = new Map<SalesState, number>();

    for (const state of FUNNEL_STATES) {
      counts.set(state, 0);
    }

    for (const conversation of conversations) {
      counts.set(
        conversation.sales_state,
        (counts.get(conversation.sales_state) || 0) + 1
      );
    }

    return FUNNEL_STATES.map((state) => ({
      state,
      count: counts.get(state) || 0,
    }));
  }, [conversations]);

  const checkoutPipeline = useMemo(
    () => conversations.filter((conversation) => CHECKOUT_STATES.includes(conversation.sales_state)),
    [conversations]
  );

  const abandonedCheckouts = useMemo(
    () =>
      checkoutPipeline
        .map((conversation) => {
          const order = ordersByConversation.get(conversation.id) || null;
          const pending = pendingFollowUpsByConversation.get(conversation.id) || [];

          return {
            ...conversation,
            order,
            estimatedValue: estimateOrderValue(order),
            pendingCount: pending.length,
            nextFollowUp: pending[0] || null,
          };
        })
        .sort(
          (left, right) =>
            new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime()
        ),
    [checkoutPipeline, ordersByConversation, pendingFollowUpsByConversation]
  );

  const filteredConversations = useMemo(() => {
    if (activeFilter === "all") return conversations;
    if (activeFilter === "hot") return hotLeads;
    if (activeFilter === "draft_orders") {
      const ids = new Set(draftOrders.map((order) => order.conversation_id));
      return conversations.filter((conversation) => ids.has(conversation.id));
    }
    if (activeFilter === "abandoned") {
      return abandonedCheckouts;
    }
    if (activeFilter === "confirmed") {
      const ids = new Set(confirmedOrders.map((order) => order.conversation_id));
      return conversations.filter((conversation) => ids.has(conversation.id));
    }
    if (activeFilter === "human_handoff") {
      return conversations.filter(
        (conversation) =>
          conversation.sales_state === "human_handoff" || conversation.mode === "human"
      );
    }
    if (activeFilter === "corporate") {
      return conversations.filter((conversation) => conversation.lead_tag === "corporate_lead");
    }
    return conversations;
  }, [activeFilter, abandonedCheckouts, confirmedOrders, conversations, draftOrders, hotLeads]);

  const selectedFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.conversation_id === selectedId),
    [followUps, selectedId]
  );

  const selectedSignals = useMemo(() => getSignalFlags(messages), [messages]);

  const openPipelineValue = useMemo(
    () => draftOrders.reduce((total, order) => total + estimateOrderValue(order), 0),
    [draftOrders]
  );

  const confirmedRevenue = useMemo(
    () => confirmedOrders.reduce((total, order) => total + estimateOrderValue(order), 0),
    [confirmedOrders]
  );

  const upsellAccepted = useMemo(
    () =>
      orders.filter((order) => order.notes?.toLowerCase().includes("upsell accepted")).length,
    [orders]
  );

  const averageConfirmedBoxes = useMemo(() => {
    if (confirmedOrders.length === 0) return 0;

    const totalBoxes = confirmedOrders.reduce((sum, order) => sum + (order.quantity || 0), 0);
    return totalBoxes / confirmedOrders.length;
  }, [confirmedOrders]);

  const recoveryCoverage = useMemo(() => {
    if (checkoutPipeline.length === 0) return 0;

    const covered = abandonedCheckouts.filter((conversation) => conversation.pendingCount > 0).length;
    return Math.round((covered / checkoutPipeline.length) * 100);
  }, [abandonedCheckouts, checkoutPipeline.length]);

  const buttonReadyCount = useMemo(
    () =>
      funnelMetrics.find((metric) => metric.state === "awaiting_confirmation")?.count || 0,
    [funnelMetrics]
  );

  const selectedPendingFollowUp = useMemo(
    () => selectedFollowUps.find((followUp) => followUp.status === "pending") || null,
    [selectedFollowUps]
  );

  const fetchConversations = useCallback(async () => {
    setLoadingConversations(true);
    setConversationError(null);

    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
      const data = await readJsonResponse(res);

      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Unable to load conversations."
        );
      }

      setConversations(Array.isArray(data) ? data : []);
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : "Unable to load conversations.");
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      const data = await readJsonResponse(res);
      setOrders(Array.isArray(data) ? data : []);
    } catch {
      setOrders([]);
    }
  }, []);

  const fetchFollowUps = useCallback(async () => {
    try {
      const res = await fetch("/api/follow-ups", { cache: "no-store" });
      const data = await readJsonResponse(res);
      setFollowUps(Array.isArray(data) ? data : []);
    } catch {
      setFollowUps([]);
    }
  }, []);

  const fetchMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        cache: "no-store",
      });
      const data = await readJsonResponse(res);
      setMessages(Array.isArray(data) ? data : []);
    } catch {
      setMessages([]);
    }
  }, []);

  const fetchSelectedOrder = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/order`, {
        cache: "no-store",
      });
      const data = await readJsonResponse(res);
      setSelectedOrder(data || null);
    } catch {
      setSelectedOrder(null);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    fetchOrders();
    fetchFollowUps();
  }, [fetchConversations, fetchOrders, fetchFollowUps]);

  useEffect(() => {
    if (!selectedId) return;
    fetchMessages(selectedId);
    fetchSelectedOrder(selectedId);
  }, [selectedId, fetchMessages, fetchSelectedOrder]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function toggleMode() {
    if (!selected) return;

    const newMode = selected.mode === "agent" ? "human" : "agent";
    const res = await fetch(`/api/conversations/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: newMode }),
    });

    if (!res.ok) return;

    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === selected.id ? { ...conversation, mode: newMode } : conversation
      )
    );
  }

  async function handleSend() {
    if (!input.trim() || !selectedId || sending) return;

    setSending(true);

    try {
      const res = await fetch(`/api/conversations/${selectedId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input.trim() }),
      });

      if (res.ok) {
        setInput("");
        await refreshSelected();
      }
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmOrder() {
    if (!selectedId) return;

    const res = await fetch(`/api/conversations/${selectedId}/confirm`, {
      method: "POST",
    });

    if (res.ok) {
      await refreshSelected();
    }
  }

  async function handleHumanHandoff() {
    if (!selectedId) return;

    const res = await fetch(`/api/conversations/${selectedId}/handoff`, {
      method: "POST",
    });

    if (res.ok) {
      await refreshSelected();
    }
  }

  async function handleScheduleFollowUp() {
    if (!selectedId || !followUpMessage.trim() || !selected) return;

    const scheduledDate = new Date();
    scheduledDate.setHours(scheduledDate.getHours() + Number(followUpHours || "24"));

    const res = await fetch(`/api/conversations/${selectedId}/follow-up`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: followUpMessage.trim(),
        scheduled_for: scheduledDate.toISOString(),
      }),
    });

    if (res.ok) {
      await fetchFollowUps();
    }
  }

  async function refreshSelected() {
    await fetchConversations();
    await fetchOrders();
    await fetchFollowUps();
    if (selectedId) {
      await fetchMessages(selectedId);
      await fetchSelectedOrder(selectedId);
    }
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString([], {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="flex h-screen bg-[#08111f] text-white">
      <div className="flex w-[360px] flex-col border-r border-white/10 bg-[#0b1324]">
        <div className="border-b border-white/10 bg-gradient-to-b from-emerald-500/10 to-transparent px-5 py-5">
          <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-300/70">
            The Mango Lover Shop
          </p>
          <h1 className="mt-2 text-lg font-semibold">Sales Console</h1>
          <p className="mt-1 text-xs text-white/45">
            Hot leads, abandoned checkouts, recovery cadence, and order visibility.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b border-white/10 p-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Hot Leads</p>
            <p className="mt-2 text-xl font-semibold">{hotLeads.length}</p>
            <p className="mt-1 text-xs text-white/40">Awaiting close or high-intent</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Open GMV</p>
            <p className="mt-2 text-xl font-semibold">{formatCurrency(openPipelineValue)}</p>
            <p className="mt-1 text-xs text-white/40">Draft + awaiting confirmation</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Pending Nudges</p>
            <p className="mt-2 text-xl font-semibold">{pendingFollowUps.length}</p>
            <p className="mt-1 text-xs text-white/40">Recovery automation live</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Upsells</p>
            <p className="mt-2 text-xl font-semibold">{upsellAccepted}</p>
            <p className="mt-1 text-xs text-white/40">Accepted order bumps</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-white/10 px-4 py-3">
          {[
            ["all", "All"],
            ["hot", "Hot"],
            ["draft_orders", "Draft"],
            ["abandoned", "Abandoned"],
            ["confirmed", "Confirmed"],
            ["human_handoff", "Human"],
            ["corporate", "Corporate"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveFilter(key as FilterKey)}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                activeFilter === key
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
                  : "border-white/10 bg-white/5 text-white/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversationError && (
            <div className="m-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              {conversationError}
            </div>
          )}

          {loadingConversations ? (
            <div className="p-4 text-xs text-white/40">Loading conversations...</div>
          ) : (
            filteredConversations.map((conversation) => {
              const isSelected = selectedId === conversation.id;
              const activeOrder = ordersByConversation.get(conversation.id) || null;
              const pendingCount =
                pendingFollowUpsByConversation.get(conversation.id)?.length || 0;

              return (
                <button
                  key={conversation.id}
                  onClick={() => setSelectedId(conversation.id)}
                  className={`w-full border-b border-white/5 px-4 py-3 text-left ${
                    isSelected ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600/80 text-xs font-semibold">
                      {getInitials(conversation.name, conversation.phone)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {conversation.name || conversation.phone}
                        </span>
                        <span className="text-[10px] text-white/30">
                          {formatTime(conversation.updated_at)}
                        </span>
                      </div>

                      <p className="mt-0.5 truncate text-xs text-white/40">
                        {conversation.last_message || "No messages yet"}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-[10px] ${badgeClass(conversation.mode)}`}>
                          {conversation.mode}
                        </span>
                        <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/70">
                          {labelize(conversation.sales_state)}
                        </span>
                        {!!pendingCount && (
                          <span className="rounded border border-yellow-500/20 bg-yellow-500/15 px-2 py-0.5 text-[10px] text-yellow-200">
                            {pendingCount} pending
                          </span>
                        )}
                        {(conversation.follow_up_count || 0) > 0 && (
                          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/55">
                            stage {Math.min((conversation.follow_up_count || 0) + 1, 3)}
                          </span>
                        )}
                        {conversation.lead_tag && (
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] ${badgeClass(
                              conversation.lead_tag
                            )}`}
                          >
                            {labelize(conversation.lead_tag)}
                          </span>
                        )}
                      </div>

                      {activeOrder?.product_size && activeOrder.quantity ? (
                        <p className="mt-2 text-[11px] text-white/35">
                          {labelize(activeOrder.product_size)} x {activeOrder.quantity} ·{" "}
                          {formatCurrency(estimateOrderValue(activeOrder))}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))] px-6 py-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">
                Revenue Growth Dashboard
              </p>
              <h2 className="mt-2 text-2xl font-semibold">Checkout Monitoring</h2>
              <p className="mt-1 text-sm text-white/45">
                Live funnel visibility for deterministic checkout, recovery automation, and upsell conversion.
              </p>
            </div>
            <div className="text-right text-xs text-white/35">
              <p>{conversations.length} live conversations</p>
              <p className="mt-1">{followUps.length} total follow-up records</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <MetricCard
              label="Open Pipeline"
              value={formatCurrency(openPipelineValue)}
              subtext={`${draftOrders.length} draft or pending confirmation orders`}
              tone="emerald"
            />
            <MetricCard
              label="Confirmed Revenue"
              value={formatCurrency(confirmedRevenue)}
              subtext={`${confirmedOrders.length} confirmed orders`}
              tone="blue"
            />
            <MetricCard
              label="Button Ready"
              value={String(buttonReadyCount)}
              subtext="Checkouts waiting for CONFIRM or UPGRADE"
              tone="amber"
            />
            <MetricCard
              label="Recovery Coverage"
              value={`${recoveryCoverage}%`}
              subtext={`${pendingFollowUps.length} pending nudges across the funnel`}
              tone="violet"
            />
            <MetricCard
              label="Upsell Accepts"
              value={String(upsellAccepted)}
              subtext="Accepted order-bump offers"
              tone="rose"
            />
            <MetricCard
              label="Average Boxes"
              value={averageConfirmedBoxes.toFixed(1)}
              subtext="Average boxes per confirmed order"
              tone="neutral"
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-white">State Funnel</p>
                  <p className="text-xs text-white/40">
                    Canonical sales states across the deterministic engine.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/55">
                  {checkoutPipeline.length} active checkouts
                </span>
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-9">
                {funnelMetrics.map((metric) => (
                  <div
                    key={metric.state}
                    className={`rounded-2xl border p-3 ${
                      metric.state === "awaiting_confirmation"
                        ? "border-yellow-500/20 bg-yellow-500/10"
                        : metric.state === "confirmed"
                          ? "border-emerald-500/20 bg-emerald-500/10"
                          : "border-white/10 bg-black/10"
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                      {labelize(metric.state)}
                    </p>
                    <p className="mt-2 text-xl font-semibold">{metric.count}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-white">Recovery Board</p>
                  <p className="text-xs text-white/40">Automation pressure and queue health.</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Pending</p>
                  <p className="mt-2 text-xl font-semibold">{pendingFollowUps.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Sent</p>
                  <p className="mt-2 text-xl font-semibold">{sentFollowUps.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">Cancelled</p>
                  <p className="mt-2 text-xl font-semibold">{cancelledFollowUps.length}</p>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-black/10 p-3 text-xs text-white/45">
                <p>{hotLeads.length} hot leads currently need attention.</p>
                <p className="mt-1">{buttonReadyCount} conversations are in the final confirmation step.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-h-0 flex-col">
            <div className="px-6 pt-5">
              <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-white">Abandoned Checkout Monitor</p>
                    <p className="text-xs text-white/40">
                      Stale deterministic checkouts, next recovery stage, and order value at risk.
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/55">
                    {abandonedCheckouts.length} monitored
                  </span>
                </div>

                <div className="max-h-[240px] divide-y divide-white/5 overflow-y-auto">
                  {abandonedCheckouts.length > 0 ? (
                    abandonedCheckouts.map((conversation) => (
                      <button
                        key={conversation.id}
                        onClick={() => setSelectedId(conversation.id)}
                        className={`w-full px-4 py-3 text-left hover:bg-white/5 ${
                          selectedId === conversation.id ? "bg-white/10" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium text-white">
                                {conversation.name || conversation.phone}
                              </p>
                              <span
                                className={`rounded px-2 py-0.5 text-[10px] ${badgeClass(
                                  conversation.sales_state
                                )}`}
                              >
                                {labelize(conversation.sales_state)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-white/40">
                              {statePromptLabel(conversation.sales_state)} · updated{" "}
                              {formatRelativeTime(conversation.updated_at)}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/45">
                              <span>
                                {conversation.order?.product_size
                                  ? `${labelize(conversation.order.product_size)} x ${
                                      conversation.order.quantity || 0
                                    }`
                                  : "Order draft pending"}
                              </span>
                              <span>•</span>
                              <span>{formatCurrency(conversation.estimatedValue)}</span>
                              <span>•</span>
                              <span>
                                {(conversation.follow_up_count || 0) >= 3
                                  ? "Recovery capped"
                                  : `Recovery stage ${Math.min(
                                      (conversation.follow_up_count || 0) + 1,
                                      3
                                    )}`}
                              </span>
                            </div>
                          </div>

                          <div className="text-right text-[11px] text-white/40">
                            <p>{conversation.pendingCount} pending</p>
                            <p className="mt-1">
                              {conversation.nextFollowUp
                                ? formatRelativeTime(conversation.nextFollowUp.scheduled_for)
                                : "no nudge queued"}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-6 text-sm text-white/35">
                      No abandoned checkouts. The deterministic funnel is currently clear.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 px-6 pb-6 pt-4">
              {selected ? (
                <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0d1628]">
                  <div className="border-b border-white/10 bg-white/[0.03] px-6 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold">
                            {selected.name || selected.phone}
                          </h3>
                          <span className={`rounded px-2 py-0.5 text-[10px] ${badgeClass(selected.mode)}`}>
                            {selected.mode}
                          </span>
                          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/70">
                            {labelize(selected.sales_state)}
                          </span>
                          {selected.lead_tag && (
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] ${badgeClass(
                                selected.lead_tag
                              )}`}
                            >
                              {labelize(selected.lead_tag)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-white/40">
                          {selected.phone} · active {formatRelativeTime(selected.updated_at)}
                        </p>
                      </div>

                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          onClick={toggleMode}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                            selected.mode === "agent"
                              ? "border-emerald-500/20 bg-emerald-500/15 text-emerald-300"
                              : "border-amber-500/20 bg-amber-500/15 text-amber-300"
                          }`}
                        >
                          {selected.mode === "agent" ? "AI Mode" : "Human Mode"}
                        </button>

                        <button
                          onClick={handleConfirmOrder}
                          className="rounded-lg border border-emerald-500/20 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300"
                        >
                          Confirm Order
                        </button>

                        <button
                          onClick={handleHumanHandoff}
                          className="rounded-lg border border-amber-500/20 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300"
                        >
                          Human Handoff
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-6 py-5">
                    <div className="space-y-4">
                      {messages.map((message, index) => {
                        const isUser = message.role === "user";
                        const showTime =
                          index === messages.length - 1 || messages[index + 1]?.role !== message.role;

                        return (
                          <div
                            key={message.id}
                            className={`flex ${isUser ? "justify-start" : "justify-end"}`}
                          >
                            <div
                              className={`flex max-w-[68%] flex-col ${
                                isUser ? "items-start" : "items-end"
                              }`}
                            >
                              <div
                                className={`rounded-2xl px-4 py-2.5 text-sm ${
                                  isUser
                                    ? "rounded-tl-sm bg-white/10 text-white"
                                    : "rounded-tr-sm bg-emerald-600 text-white"
                                }`}
                              >
                                <p className="whitespace-pre-wrap">{message.content}</p>
                              </div>
                              {showTime && (
                                <p className="mt-1 px-1 text-[10px] text-white/25">
                                  {!isUser && "AI · "} {formatTime(message.created_at)}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="border-t border-white/10 bg-white/[0.03] px-6 py-4">
                    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5">
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                        placeholder="Type a message..."
                        className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
                      />
                      <button
                        onClick={handleSend}
                        disabled={sending || !input.trim()}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500 disabled:opacity-40"
                      >
                        {sending ? "..." : "Send"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col justify-between rounded-3xl border border-white/10 bg-[#0d1628] p-6">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                      Conversation Detail
                    </p>
                    <h3 className="mt-2 text-xl font-semibold">Select a lead to operate the funnel</h3>
                    <p className="mt-2 max-w-xl text-sm text-white/45">
                      Choose a conversation from the left rail or the abandoned checkout monitor to review messages, confirm orders, schedule nudges, or move a lead to human handoff.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <p className="text-xs font-medium text-white">Priority queue</p>
                    <div className="mt-3 space-y-2">
                      {hotLeads.slice(0, 4).map((conversation) => {
                        const order = ordersByConversation.get(conversation.id) || null;
                        return (
                          <button
                            key={conversation.id}
                            onClick={() => setSelectedId(conversation.id)}
                            className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/10"
                          >
                            <div>
                              <p className="text-sm font-medium text-white">
                                {conversation.name || conversation.phone}
                              </p>
                              <p className="mt-1 text-xs text-white/40">
                                {labelize(conversation.sales_state)} ·{" "}
                                {formatCurrency(estimateOrderValue(order))}
                              </p>
                            </div>
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] ${badgeClass(
                                conversation.sales_state
                              )}`}
                            >
                              {statePromptLabel(conversation.sales_state)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto border-l border-white/10 bg-[#09111f] p-4">
            {selected ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                    Lead Snapshot
                  </p>
                  <div className="mt-3 flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600/80 text-sm font-semibold">
                      {getInitials(selected.name, selected.phone)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">
                        {selected.name || selected.phone}
                      </p>
                      <p className="mt-1 text-xs text-white/40">{selected.phone}</p>
                      <p className="mt-2 text-xs text-white/45">
                        Last intent: {labelize(selected.last_customer_intent)}
                      </p>
                      <p className="mt-1 text-xs text-white/45">
                        Recovery stage:{" "}
                        {(selected.follow_up_count || 0) >= 3
                          ? "capped"
                          : Math.min((selected.follow_up_count || 0) + 1, 3)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                      Order Summary
                    </p>
                    {selectedOrder && (
                      <span className="text-sm font-semibold text-emerald-300">
                        {formatCurrency(estimateOrderValue(selectedOrder))}
                      </span>
                    )}
                  </div>

                  {selectedOrder ? (
                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="text-[11px] text-white/40">Status</p>
                        <span
                          className={`mt-1 inline-block rounded px-2 py-0.5 text-[10px] ${badgeClass(
                            selectedOrder.status
                          )}`}
                        >
                          {labelize(selectedOrder.status)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[11px] text-white/40">Customer</p>
                          <p className="mt-1 text-sm">{selectedOrder.customer_name || "-"}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-white/40">Order Type</p>
                          <p className="mt-1 text-sm">{labelize(selectedOrder.order_type)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-white/40">Product</p>
                          <p className="mt-1 text-sm">{labelize(selectedOrder.product_size)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-white/40">Quantity</p>
                          <p className="mt-1 text-sm">{selectedOrder.quantity ?? "-"}</p>
                        </div>
                      </div>

                      <div>
                        <p className="text-[11px] text-white/40">Delivery Address</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">
                          {selectedOrder.delivery_address || "-"}
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] text-white/40">Preferred Date</p>
                        <p className="mt-1 text-sm">{selectedOrder.delivery_date || "-"}</p>
                      </div>

                      {selectedOrder.notes && (
                        <div>
                          <p className="text-[11px] text-white/40">Internal Notes</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-white/75">
                            {selectedOrder.notes}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/10 p-3 text-sm text-white/35">
                      No draft or confirmed order yet.
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                    Interactive Signals
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <SignalPill label="CONFIRM tapped" active={selectedSignals.hasConfirm} />
                    <SignalPill label="UPGRADE tapped" active={selectedSignals.hasUpgrade} />
                    <SignalPill label="EDIT ORDER tapped" active={selectedSignals.hasEdit} />
                  </div>
                  <p className="mt-3 text-xs text-white/45">
                    Last detected action: {selectedSignals.lastAction || "none"}
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    Next recovery nudge:{" "}
                    {selectedPendingFollowUp
                      ? formatRelativeTime(selectedPendingFollowUp.scheduled_for)
                      : "none queued"}
                  </p>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                    Schedule Follow-up
                  </p>
                  <div className="mt-3 space-y-3">
                    <textarea
                      value={followUpMessage}
                      onChange={(e) => setFollowUpMessage(e.target.value)}
                      className="min-h-[100px] w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white focus:outline-none"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        value={followUpHours}
                        onChange={(e) => setFollowUpHours(e.target.value)}
                        className="w-20 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
                      />
                      <span className="text-xs text-white/45">hours from now</span>
                    </div>
                    <button
                      onClick={handleScheduleFollowUp}
                      className="w-full rounded-xl border border-blue-500/20 bg-blue-500/15 py-2 text-sm text-blue-300"
                    >
                      Add Follow-up
                    </button>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                    Follow-up Queue
                  </p>
                  <div className="mt-3 space-y-2">
                    {selectedFollowUps.length > 0 ? (
                      selectedFollowUps.map((followUp) => (
                        <div key={followUp.id} className="rounded-2xl border border-white/10 bg-black/10 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] ${badgeClass(
                                followUp.status
                              )}`}
                            >
                              {labelize(followUp.status)}
                            </span>
                            <span className="text-[10px] text-white/35">
                              {formatDate(followUp.scheduled_for)}
                            </span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-white/85">
                            {followUp.message}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-black/10 p-3 text-xs text-white/30">
                        No follow-ups scheduled for this conversation.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                    Hot Lead Queue
                  </p>
                  <div className="mt-3 space-y-2">
                    {hotLeads.slice(0, 6).map((conversation) => {
                      const order = ordersByConversation.get(conversation.id) || null;
                      const pending = pendingFollowUpsByConversation.get(conversation.id)?.length || 0;
                      return (
                        <button
                          key={conversation.id}
                          onClick={() => setSelectedId(conversation.id)}
                          className="w-full rounded-2xl border border-white/10 bg-black/10 p-3 text-left hover:bg-white/10"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium text-white">
                              {conversation.name || conversation.phone}
                            </p>
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] ${badgeClass(
                                conversation.sales_state
                              )}`}
                            >
                              {labelize(conversation.sales_state)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-white/40">
                            {formatCurrency(estimateOrderValue(order))} · {pending} pending follow-ups
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                    Pending Follow-ups
                  </p>
                  <div className="mt-3 space-y-2">
                    {pendingFollowUps.slice(0, 8).map((followUp) => (
                      <button
                        key={followUp.id}
                        onClick={() => setSelectedId(followUp.conversation_id)}
                        className="w-full rounded-2xl border border-white/10 bg-black/10 p-3 text-left hover:bg-white/10"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`rounded px-2 py-0.5 text-[10px] ${badgeClass(followUp.status)}`}>
                            {labelize(followUp.status)}
                          </span>
                          <span className="text-[10px] text-white/35">
                            {formatDate(followUp.scheduled_for)}
                          </span>
                        </div>
                        <p className="mt-2 truncate text-sm text-white/85">{followUp.message}</p>
                      </button>
                    ))}

                    {pendingFollowUps.length === 0 && (
                      <div className="rounded-2xl border border-white/10 bg-black/10 p-3 text-xs text-white/30">
                        No pending follow-ups.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
