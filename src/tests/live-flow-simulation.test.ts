import crypto from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, FollowUp, Message, Order, WebhookLog } from "@/lib/types";

type InMemoryDb = {
  conversations: Conversation[];
  messages: Message[];
  orders: Order[];
  followUps: FollowUp[];
  sentReplies: Array<{
    to: string;
    body: string;
    buttons?: Array<{ id: string; title: string }>;
    id: string;
  }>;
  aiCalls: number;
  aiRequests: Array<{
    messages: Array<{ role: string; content: string }>;
  }>;
  aiResponder: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  idCounter: number;
  failNextConversationOptimisticUpdate: boolean;
  webhook_logs: WebhookLog[];
};

type TableName = "conversations" | "messages" | "orders" | "follow_ups" | "webhook_logs";

type SelectMode = "many" | "single" | "maybeSingle";

function createDb(): InMemoryDb {
  return {
    conversations: [],
    messages: [],
    orders: [],
    followUps: [],
    sentReplies: [],
    aiCalls: 0,
    aiRequests: [],
    aiResponder: async (messages) => defaultSmartReply(messages),
    idCounter: 1,
    failNextConversationOptimisticUpdate: false,
    webhook_logs: [],
  };
}

function nextId(db: InMemoryDb, prefix: string) {
  const value = `${prefix}-${db.idCounter}`;
  db.idCounter += 1;
  return value;
}

function getLatestPromptMessage(messages: Array<{ role: string; content: string }>) {
  return (
    [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.trim()
      .toLowerCase() || ""
  );
}

function defaultSmartReply(messages: Array<{ role: string; content: string }>) {
  switch (getLatestPromptMessage(messages)) {
    case "hi":
      return Promise.resolve(
        "Hi! Welcome to The Mango Lover Shop. What are you looking for today?"
      );
    case "price?":
      return Promise.resolve(
        "We have Medium, Large, and Jumbo Devgad Alphonso options. If you want, I can help you choose the right size."
      );
    case "natural hai?":
      return Promise.resolve(
        "Yes, our Devgad Alphonso mangoes are naturally ripened and carbide-free."
      );
    case "which is best?":
      return Promise.resolve(
        "Large gives the best balance for most buyers. Jumbo is usually best if you're buying for gifting."
      );
    case "payment done":
      return Promise.resolve(
        "Noted. If you want, send the payment reference or screenshot and I'll help from there."
      );
    default:
      return Promise.resolve(
        "Happy to help with mangoes, pricing, delivery, or your order. What would you like to know?"
      );
  }
}

function nowIso() {
  return new Date().toISOString();
}

function cloneRow<T>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

function parseSelectedColumns(selection?: string) {
  if (!selection || selection === "*") return null;
  return selection
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

function projectRow<T extends Record<string, unknown>>(row: T, selection?: string) {
  const columns = parseSelectedColumns(selection);
  if (!columns) return cloneRow(row);

  const projected: Record<string, unknown> = {};
  for (const column of columns) {
    projected[column] = row[column];
  }
  return projected;
}

function sortRows(rows: Record<string, unknown>[], column: string, ascending: boolean) {
  return [...rows].sort((left, right) => {
    const leftValue = left[column];
    const rightValue = right[column];

    if (leftValue === rightValue) return 0;
    if (leftValue == null) return ascending ? -1 : 1;
    if (rightValue == null) return ascending ? 1 : -1;

    const leftTime = new Date(String(leftValue)).getTime();
    const rightTime = new Date(String(rightValue)).getTime();

    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
      return ascending ? leftTime - rightTime : rightTime - leftTime;
    }

    const leftString = String(leftValue);
    const rightString = String(rightValue);
    return ascending
      ? leftString.localeCompare(rightString)
      : rightString.localeCompare(leftString);
  });
}

function createConversation(db: InMemoryDb, payload: Record<string, unknown>) {
  const timestamp = nowIso();
  return {
    id: String(payload.id ?? nextId(db, "conv")),
    phone: String(payload.phone),
    name: payload.name ? String(payload.name) : null,
    mode: (payload.mode as Conversation["mode"]) ?? "agent",
    updated_at: String(payload.updated_at ?? timestamp),
    created_at: String(payload.created_at ?? timestamp),
    sales_state: (payload.sales_state as Conversation["sales_state"]) ?? "new",
    lead_tag: (payload.lead_tag as Conversation["lead_tag"]) ?? null,
    last_customer_intent:
      (payload.last_customer_intent as Conversation["last_customer_intent"]) ?? null,
    follow_up_count:
      typeof payload.follow_up_count === "number" ? payload.follow_up_count : 0,
    last_follow_up_sent_at:
      payload.last_follow_up_sent_at != null ? String(payload.last_follow_up_sent_at) : null,
  } satisfies Conversation;
}

function createMessage(db: InMemoryDb, payload: Record<string, unknown>) {
  return {
    id: String(payload.id ?? nextId(db, "msg")),
    conversation_id: String(payload.conversation_id),
    role: payload.role as Message["role"],
    content: String(payload.content),
    whatsapp_msg_id:
      payload.whatsapp_msg_id != null ? String(payload.whatsapp_msg_id) : null,
    created_at: String(payload.created_at ?? nowIso()),
  } satisfies Message;
}

function createOrder(db: InMemoryDb, payload: Record<string, unknown>) {
  const timestamp = nowIso();
  return {
    id: String(payload.id ?? nextId(db, "ord")),
    conversation_id: String(payload.conversation_id),
    customer_name: payload.customer_name != null ? String(payload.customer_name) : null,
    phone: String(payload.phone),
    product_size: (payload.product_size as Order["product_size"]) ?? null,
    quantity: typeof payload.quantity === "number" ? payload.quantity : null,
    delivery_address:
      payload.delivery_address != null ? String(payload.delivery_address) : null,
    delivery_date: payload.delivery_date != null ? String(payload.delivery_date) : null,
    order_type: (payload.order_type as Order["order_type"]) ?? "personal",
    status: (payload.status as Order["status"]) ?? "draft",
    notes: payload.notes != null ? String(payload.notes) : null,
    created_at: String(payload.created_at ?? timestamp),
    updated_at: String(payload.updated_at ?? timestamp),
  } satisfies Order;
}

function createFollowUp(db: InMemoryDb, payload: Record<string, unknown>) {
  const timestamp = nowIso();
  return {
    id: String(payload.id ?? nextId(db, "fup")),
    conversation_id: String(payload.conversation_id),
    phone: String(payload.phone),
    message: String(payload.message),
    status: (payload.status as FollowUp["status"]) ?? "pending",
    scheduled_for: String(payload.scheduled_for ?? timestamp),
    sent_at: payload.sent_at != null ? String(payload.sent_at) : null,
    created_at: String(payload.created_at ?? timestamp),
    updated_at: String(payload.updated_at ?? timestamp),
  } satisfies FollowUp;
}

function createWebhookLog(db: InMemoryDb, payload: Record<string, unknown>) {
  return {
    id: String(payload.id ?? nextId(db, "log")),
    whatsapp_msg_id: payload.whatsapp_msg_id != null ? String(payload.whatsapp_msg_id) : null,
    phone: payload.phone != null ? String(payload.phone) : null,
    status: String(payload.status),
    payload: (payload.payload as Record<string, unknown>) ?? null,
    error: payload.error != null ? String(payload.error) : null,
    duration_ms: typeof payload.duration_ms === "number" ? payload.duration_ms : null,
    created_at: String(payload.created_at ?? nowIso()),
  } satisfies WebhookLog;
}

class QueryBuilder {
  private filters: Array<(row: Record<string, unknown>) => boolean> = [];
  private equalityFilters = new Map<string, unknown>();
  private selectedColumns: string | undefined;
  private action: "select" | "insert" | "update" = "select";
  private insertPayload: Record<string, unknown>[] = [];
  private updatePatch: Record<string, unknown> | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private returning = false;

  constructor(
    private readonly db: InMemoryDb,
    private readonly table: TableName
  ) {}

  select(columns = "*") {
    this.selectedColumns = columns;
    this.returning = true;
    return this;
  }

  insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
    this.action = "insert";
    this.insertPayload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.action = "update";
    this.updatePatch = patch;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    this.equalityFilters.set(column, value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push((row) => String(row[column] ?? "") > String(value ?? ""));
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push((row) => String(row[column] ?? "") <= String(value ?? ""));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    return this.execute("single");
  }

  maybeSingle() {
    return this.execute("maybeSingle");
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: { code?: string; message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute("many").then(onfulfilled, onrejected);
  }

  private getTableRows() {
    switch (this.table) {
      case "conversations":
        return this.db.conversations as unknown as Record<string, unknown>[];
      case "messages":
        return this.db.messages as unknown as Record<string, unknown>[];
      case "orders":
        return this.db.orders as unknown as Record<string, unknown>[];
      case "follow_ups":
        return this.db.followUps as unknown as Record<string, unknown>[];
      case "webhook_logs":
        return this.db.webhook_logs as unknown as Record<string, unknown>[];
    }
  }

  private async execute(mode: SelectMode) {
    if (this.action === "insert") {
      return this.executeInsert(mode);
    }

    if (this.action === "update") {
      return this.executeUpdate(mode);
    }

    return this.executeSelect(mode);
  }

  private applyFilters(rows: Record<string, unknown>[]) {
    let result = rows.filter((row) => this.filters.every((filter) => filter(row)));

    if (this.orderBy) {
      result = sortRows(result, this.orderBy.column, this.orderBy.ascending);
    }

    if (this.limitCount != null) {
      result = result.slice(0, this.limitCount);
    }

    return result;
  }

  private formatResult(rows: Record<string, unknown>[], mode: SelectMode) {
    const projected = rows.map((row) => projectRow(row, this.selectedColumns));

    if (mode === "single") {
      if (projected.length !== 1) {
        return { data: null, error: { message: "Expected a single row" } };
      }
      return { data: projected[0], error: null };
    }

    if (mode === "maybeSingle") {
      if (projected.length === 0) return { data: null, error: null };
      if (projected.length > 1) {
        return { data: null, error: { message: "Expected zero or one row" } };
      }
      return { data: projected[0], error: null };
    }

    return { data: this.returning ? projected : null, error: null };
  }

  private async executeSelect(mode: SelectMode) {
    const rows = this.applyFilters(this.getTableRows());
    return this.formatResult(rows, mode);
  }

  private async executeInsert(mode: SelectMode) {
    const rows = this.getTableRows();
    const inserted: Record<string, unknown>[] = [];

    for (const payload of this.insertPayload) {
      if (
        this.table === "conversations" &&
        payload.phone &&
        rows.some((row) => row.phone === payload.phone)
      ) {
        return { data: null, error: { code: "23505", message: "duplicate key value" } };
      }

      if (
        this.table === "messages" &&
        payload.whatsapp_msg_id &&
        rows.some((row) => row.whatsapp_msg_id === payload.whatsapp_msg_id)
      ) {
        return { data: null, error: { code: "23505", message: "duplicate key value" } };
      }

      const created =
        this.table === "conversations"
          ? createConversation(this.db, payload)
          : this.table === "messages"
            ? createMessage(this.db, payload)
            : this.table === "orders"
              ? createOrder(this.db, payload)
              : this.table === "webhook_logs"
                ? createWebhookLog(this.db, payload)
                : createFollowUp(this.db, payload);

      rows.push(created as unknown as Record<string, unknown>);
      inserted.push(created as unknown as Record<string, unknown>);
    }

    return this.formatResult(inserted, mode);
  }

  private async executeUpdate(mode: SelectMode) {
    if (
      this.table === "conversations" &&
      this.db.failNextConversationOptimisticUpdate &&
      this.equalityFilters.has("updated_at")
    ) {
      this.db.failNextConversationOptimisticUpdate = false;
      return this.formatResult([], mode);
    }

    const rows = this.applyFilters(this.getTableRows());

    for (const row of rows) {
      Object.assign(row, this.updatePatch ?? {});
    }

    return this.formatResult(rows, mode);
  }
}

function createSupabaseMock(db: InMemoryDb) {
  return {
    from(table: TableName) {
      return new QueryBuilder(db, table);
    },
  };
}

function buildWebhookPayload(args: {
  messageId: string;
  phone?: string;
  name?: string;
  text?: string;
  buttonTitle?: string;
}) {
  const phone = args.phone ?? "919000000000";
  const name = args.name ?? "Raj";

  const message = args.buttonTitle
    ? {
        from: phone,
        id: args.messageId,
        type: "interactive",
        interactive: {
          button_reply: {
            title: args.buttonTitle,
          },
        },
      }
    : {
        from: phone,
        id: args.messageId,
        type: "text",
        text: {
          body: args.text ?? "",
        },
      };

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [
                {
                  profile: {
                    name,
                  },
                },
              ],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

function signPayload(payload: string) {
  const secret = process.env.WHATSAPP_APP_SECRET ?? "";
  const digest = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

async function importWebhookRoute(db: InMemoryDb) {
  vi.resetModules();

  vi.doMock("server-only", () => ({}));

  vi.doMock("@/lib/supabase", () => ({
    supabase: createSupabaseMock(db),
  }));

  vi.doMock("@/lib/whatsapp", () => ({
    sendWhatsAppMessage: vi.fn(async (to: string, body: string, buttons?: Array<{ id: string; title: string }>) => {
      const id = `wamid.${nextId(db, "outbound")}`;
      db.sentReplies.push({ to, body, buttons, id });
      return { messages: [{ id }] };
    }),
  }));

  vi.doMock("@/lib/ai", () => ({
    getAIConfig: vi.fn(() => ({ model: "test-model", provider: "openai" })),
    getOpenAIClient: vi.fn(() => ({
      chat: {
        completions: {
          create: vi.fn(async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
            db.aiCalls += 1;
            const requestMessages = (messages || []).map((message) => ({
              role: String(message.role),
              content: String(message.content),
            }));
            db.aiRequests.push({ messages: requestMessages });
            const content = await db.aiResponder(requestMessages);

            return {
              choices: [{ message: { content } }],
            };
          }),
        },
      },
    })),
    getAIResponse: vi.fn(async () => {
      db.aiCalls += 1;
      return "Unused legacy AI path";
    }),
  }));

  return import("@/app/api/webhook/route");
}

async function postWebhook(
  route: Awaited<ReturnType<typeof importWebhookRoute>>,
  payload: Record<string, unknown>
) {
  const raw = JSON.stringify(payload);
  const request = new NextRequest("http://localhost:3000/api/webhook", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signPayload(raw),
    },
  });

  return route.POST(request);
}

describe("Webhook Smart Reply Flow", () => {
  let db: InMemoryDb;

  beforeEach(() => {
    db = createDb();
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token";
    process.env.WHATSAPP_ACCESS_TOKEN = "meta-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
  });

  it("stores inbound and outbound messages and sends a natural reply through the webhook", async () => {
    const route = await importWebhookRoute(db);
    const response = await postWebhook(
      route,
      buildWebhookPayload({ messageId: "msg-hi", text: "Hi" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("replied");
    expect(db.aiCalls).toBe(1);
    expect(db.conversations).toHaveLength(1);
    expect(db.sentReplies).toHaveLength(1);
    expect(db.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(db.messages.filter((message) => message.role === "assistant")).toHaveLength(1);

    const lastAssistantMessage = [...db.messages]
      .filter((message) => message.role === "assistant")
      .at(-1);

    expect(lastAssistantMessage?.content).toBe(
      "Hi! Welcome to The Mango Lover Shop. What are you looking for today?"
    );
    expect(lastAssistantMessage?.whatsapp_msg_id).toMatch(/^wamid\./);
    expect(db.sentReplies[0]?.body).toBe(lastAssistantMessage?.content);
  });

  it("builds AI context from recent history without duplicating the latest inbound message", async () => {
    const conversation = createConversation(db, {
      phone: "919000000000",
      sales_state: "new",
    });
    db.conversations.push(conversation);
    for (let index = 0; index < 15; index += 1) {
      db.messages.push(
        createMessage(db, {
          conversation_id: conversation.id,
          role: index % 2 === 0 ? "user" : "assistant",
          content: `history-${index + 1}`,
        })
      );
    }

    const route = await importWebhookRoute(db);
    const response = await postWebhook(
      route,
      buildWebhookPayload({ messageId: "msg-history", text: "Need delivery in Mumbai" })
    );

    expect(response.status).toBe(200);
    expect(db.aiCalls).toBe(1);
    expect(db.aiRequests).toHaveLength(1);

    const requestMessages = db.aiRequests[0]?.messages || [];
    expect(requestMessages[0]?.role).toBe("system");
    expect(requestMessages.filter((message) => message.content === "Need delivery in Mumbai")).toHaveLength(1);
    expect(requestMessages.length).toBeLessThanOrEqual(14);
    expect(requestMessages.length).toBeGreaterThanOrEqual(10);
  });

  it("regenerates once when the first AI draft repeats a recent assistant reply", async () => {
    const conversation = createConversation(db, {
      phone: "919000000000",
      sales_state: "new",
    });
    db.conversations.push(conversation);
    db.messages.push(
      createMessage(db, {
        conversation_id: conversation.id,
        role: "assistant",
        content: "Large gives the best balance for most buyers.",
      })
    );
    db.aiResponder = async () =>
      db.aiCalls === 1
        ? "Large gives the best balance for most buyers."
        : "Large is the best fit for most buyers, and Jumbo works better if you're buying for gifting.";

    const route = await importWebhookRoute(db);
    const response = await postWebhook(
      route,
      buildWebhookPayload({ messageId: "msg-repeat", text: "which is best?" })
    );

    expect(response.status).toBe(200);
    expect(db.aiCalls).toBe(2);
    expect(db.sentReplies).toHaveLength(1);
    expect(db.sentReplies[0]?.body).toBe(
      "Large is the best fit for most buyers, and Jumbo works better if you're buying for gifting."
    );
  });

  it("uses the safe fallback when AI generation fails", async () => {
    db.aiResponder = async () => {
      throw new Error("provider down");
    };
    const route = await importWebhookRoute(db);
    const response = await postWebhook(
      route,
      buildWebhookPayload({ messageId: "msg-fallback", text: "price?" })
    );

    expect(response.status).toBe(200);
    expect(db.sentReplies).toHaveLength(1);
    expect(db.sentReplies[0]?.body).toBe(
      "I'm here to help. Please tell me if you're looking for mango availability, pricing, delivery, or order support."
    );
    expect(db.messages.filter((message) => message.role === "assistant").at(-1)?.content).toBe(
      "I'm here to help. Please tell me if you're looking for mango availability, pricing, delivery, or order support."
    );
  });

  it("ignores duplicate inbound webhook deliveries without sending twice", async () => {
    const route = await importWebhookRoute(db);

    const firstResponse = await postWebhook(
      route,
      buildWebhookPayload({ messageId: "msg-duplicate", text: "Hi" })
    );
    const secondResponse = await postWebhook(
      route,
      buildWebhookPayload({ messageId: "msg-duplicate", text: "Hi" })
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(db.sentReplies).toHaveLength(1);
    expect(db.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(db.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });
});
