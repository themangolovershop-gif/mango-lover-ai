"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { calculateOrderValue, sizeLabel } from "@/lib/sales-analytics";
import {
  MessageSquare, CheckCircle2, User, Activity,
  Phone, MapPin, Tag, LogOut, Shield,
  Database, Zap,
  RefreshCw, ArrowRight,
} from "lucide-react";

// ─── TYPES ───────────────────────────────────────────────────────────────────
type SalesState =
  | "new" | "browsing" | "awaiting_quantity" | "awaiting_name"
  | "awaiting_address" | "awaiting_date" | "awaiting_confirmation"
  | "confirmed" | "human_handoff" | "lost";

type LeadTag = "hot" | "warm" | "cold" | "corporate_lead" | "gift_lead" | null;
type Mode = "agent" | "human";
type OrderStatus = "draft" | "awaiting_confirmation" | "confirmed" | "cancelled";

interface Conversation {
  id: string;
  name: string | null;
  phone: string;
  mode: Mode;
  sales_state: SalesState;
  lead_tag: LeadTag;
  updated_at: string;
  last_message: string | null;
  messages: Message[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface RealtimeMessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface Order {
  id: string;
  status: OrderStatus;
  product_size: "medium" | "large" | "jumbo" | null;
  quantity: number | null;
  delivery_address: string | null;
  delivery_date: string | null;
  notes: string | null;
}

interface FollowUp {
  id: string;
  message: string;
  status: "pending" | "sent" | "cancelled";
  scheduled_for: string;
}

interface WebhookLog {
  id: string;
  status: "success" | "error" | "signature_failed";
  phone: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function initials(name: string | null, phone: string): string {
  if (name) return name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  return phone.slice(-2);
}

function formatOrderProduct(order: Order): string {
  if (!order.product_size && !order.quantity) return "Pending selection";
  if (!order.product_size) return `${order.quantity ?? "-"}x Box`;
  return `${order.quantity ?? "-"}x ${sizeLabel(order.product_size)} Box`;
}

function avatarColor(id: string): string {
  const COLORS = [
    "bg-indigo-500/20 text-indigo-300 border-indigo-500/10",
    "bg-amber-500/20  text-amber-300  border-amber-500/10",
    "bg-emerald-500/20 text-emerald-300 border-emerald-500/10",
    "bg-violet-500/20 text-violet-300 border-violet-500/10",
    "bg-rose-500/20   text-rose-300   border-rose-500/10",
  ];
  return COLORS[parseInt(id, 10) % COLORS.length] || COLORS[0]!;
}

function mergeConversationMessage(
  conversations: Conversation[],
  realtimeMessage: RealtimeMessageRow
) {
  const nextMessage: Message = {
    id: realtimeMessage.id,
    role: realtimeMessage.role,
    content: realtimeMessage.content,
    created_at: realtimeMessage.created_at,
  };

  return conversations
    .map((conversation) => {
      if (conversation.id !== realtimeMessage.conversation_id) {
        return conversation;
      }

      const existingIndex = conversation.messages.findIndex(
        (message) =>
          message.id === nextMessage.id ||
          (message.id.startsWith("opt-") &&
            message.role === nextMessage.role &&
            message.content === nextMessage.content)
      );

      const messages =
        existingIndex === -1
          ? [...conversation.messages, nextMessage]
          : conversation.messages.map((message, index) =>
              index === existingIndex ? nextMessage : message
            );

      return {
        ...conversation,
        messages,
        last_message: nextMessage.content,
        updated_at: nextMessage.created_at,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
    );
}

// ─── RESTRAINED SUB COMPONENTS ──────────────────────────────────────────────

function Dot({ status }: { status: "green" | "amber" | "red" | "gray" }) {
  const colors = {
    green: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)] status-pulse",
    amber: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]",
    red:   "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]",
    gray:  "bg-white/20"
  };
  return <span className={`h-1.5 w-1.5 rounded-full ${colors[status]} shrink-0 transition-all duration-500`} />;
}

function Badge({ label, variant }: { label: string; variant: "hot" | "warm" | "cold" | "corporate" | "gift" | "state" | "confirmed" | "handoff" }) {
  const cls: Record<string, string> = {
    hot:       "bg-rose-500/10 text-rose-400 border-rose-500/20",
    warm:      "bg-amber-500/10 text-amber-400 border-amber-500/20",
    cold:      "bg-white/5 text-white/30 border-white/5",
    corporate: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    gift:      "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20",
    state:     "bg-white/5 text-white/40 border-white/5",
    confirmed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    handoff:   "bg-amber-500/10 text-amber-400 border-amber-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${cls[variant] || cls.state}`}>
      {label}
    </span>
  );
}

function HealthService({ label, status, icon: Icon }: { label: string; status: "green" | "amber" | "red" | "gray"; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 hover:bg-white/5 rounded-md transition-colors cursor-default">
      <Icon size={11} className="text-white/20" />
      <span className="text-[10px] text-white/40 font-bold uppercase tracking-tighter">{label}</span>
      <Dot status={status} />
    </div>
  );
}

function Row({ label, value, icon, truncate }: { label: string; value: string; icon?: React.ReactNode; truncate?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="text-white/15 mt-1 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <span className="block text-[8px] text-white/20 uppercase tracking-[0.2em] font-bold mb-0.5">{label}</span>
        <span className={`block text-[11px] text-white/70 font-medium leading-relaxed ${truncate ? "line-clamp-2" : ""}`}>{value}</span>
      </div>
    </div>
  );
}

// ─── LOGIN SCREEN ────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) onLogin();
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[#070d1b]">
      <div className="w-full max-w-[320px] fade-up">
        <div className="mb-8 flex flex-col items-center gap-4">
          <div className="h-12 w-12 flex items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20">
            <span className="text-xl">🥭</span>
          </div>
          <div className="text-center">
            <h1 className="text-lg font-bold text-white tracking-tight">The Mango Lover Shop</h1>
            <p className="text-[11px] text-white/25 uppercase tracking-widest mt-1">Operator Console</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="password"
              value={pw}
              onChange={e => { setPw(e.target.value); setError(false); }}
              placeholder="Admin password"
              className={`w-full rounded-xl border bg-white/2 px-4 py-3 text-sm text-white placeholder:text-white/15 outline-none transition-all focus:border-amber-500/40 ${
                error ? "border-rose-500/50" : "border-white/5"
              }`}
            />
          </div>
          <button
            type="submit"
            disabled={!pw || loading}
            className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-[#070d1b] transition-all hover:bg-amber-400 active:scale-[0.98] disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Shield size={14} />}
            {loading ? "Verifying" : "Unlock Console"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── HEADER ──────────────────────────────────────────────────────────────────
function Header({ onLogout, activeTab, setActiveTab }: { onLogout: () => void; activeTab: string; setActiveTab: (t: string) => void; }) {
  const [health, setHealth] = useState({ wa: "gray", db: "gray", ai: "gray", webhook: "gray" });

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (res.ok) setHealth(await res.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="h-14 flex items-center justify-between border-b border-white/5 bg-[#070d1b] px-6 shrink-0 z-50">
      <div className="flex items-center gap-10">
        <div className="flex items-center gap-3">
          <span className="text-xl">🥭</span>
          <div className="h-4 w-px bg-white/10" />
          <span className="text-[12px] font-bold text-white/90 tracking-tight uppercase">Console</span>
        </div>

        <nav className="flex items-center gap-1">
          {["inbox", "logs"].map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-all rounded-md ${
                activeTab === t ? "text-amber-400 bg-amber-400/5" : "text-white/25 hover:text-white/50"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-6">
      <div className="flex items-center gap-1 border border-white/5 rounded-lg bg-white/2 p-0.5">
        <HealthService label="WA" status={health.wa as "green" | "amber" | "red" | "gray"} icon={Phone} />
        <HealthService label="DB" status={health.db as "green" | "amber" | "red" | "gray"} icon={Database} />
        <HealthService label="AI" status={health.ai as "green" | "amber" | "red" | "gray"} icon={Zap} />
        <HealthService label="WH" status={health.webhook as "green" | "amber" | "red" | "gray"} icon={Activity} />
      </div>
        <button onClick={onLogout} title="Logout" aria-label="Logout" className="text-white/20 hover:text-rose-400 transition-colors">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}

// ─── LEAD INBOX ──────────────────────────────────────────────────────────────
interface LeadInboxProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}

function LeadInbox({ conversations, selectedId, onSelect, loading }: LeadInboxProps) {
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    if (filter === "hot") return conversations.filter(c => c.lead_tag === "hot" || c.sales_state === "awaiting_confirmation");
    if (filter === "human") return conversations.filter(c => c.mode === "human");
    return conversations;
  }, [conversations, filter]);

  return (
    <div className="w-[300px] shrink-0 flex flex-col border-r border-white/5 bg-[#070d1b]/50">
      <div className="p-4 border-b border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[9px] font-bold text-white/30 uppercase tracking-[0.2em]">Conversations</h2>
          <span className="text-[10px] text-white/20 font-mono">{loading ? "..." : conversations.length}</span>
        </div>
        <div className="flex gap-1">
          {["all", "hot", "human"].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all border ${
                filter === f ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-white/5 text-white/30 hover:bg-white/5"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading && <div className="p-4 space-y-4 opacity-20">
          {[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-white/5 rounded animate-pulse" />)}
        </div>}
        
        {filtered.map(c => {
          const isSelected = c.id === selectedId;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`w-full text-left px-4 py-4 border-b border-white/5 transition-all relative ${
                isSelected ? "bg-white/5" : "hover:bg-white/2"
              }`}
            >
              {isSelected && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-amber-500" />}
              <div className="flex items-start justify-between mb-1">
                <span className={`text-[13px] font-semibold tracking-tight ${isSelected ? "text-white" : "text-white/80"}`}>
                  {c.name || c.phone.slice(-4)}
                </span>
                <span className="text-[10px] text-white/20 font-medium">{relTime(c.updated_at)}</span>
              </div>
              <p className="text-[11px] text-white/30 line-clamp-1 mb-2 font-medium">
                {c.last_message || "No messages"}
              </p>
              <div className="flex gap-1.5 items-center">
                {c.lead_tag === "hot" && <Badge label="Hot" variant="hot" />}
                {c.mode === "human" && <Badge label="Human" variant="handoff" />}
                <span className="text-[9px] text-white/10 uppercase tracking-widest font-bold">
                  {c.sales_state.split('_')[1] || c.sales_state}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── CHAT PANEL ──────────────────────────────────────────────────────────────
interface ChatPanelProps {
  conversation: Conversation | undefined;
  messages: Message[];
  mode: Mode;
  onModeToggle: () => void;
  onSend: (msg: string) => void;
}

function ChatPanel({ conversation, messages, mode, onModeToggle, onSend }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  if (!conversation) return (
    <div className="flex-1 flex flex-col items-center justify-center opacity-10">
      <MessageSquare size={48} strokeWidth={1} />
      <span className="text-[11px] uppercase tracking-[0.2em] font-bold mt-4">Select conversation</span>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#070d1b]">
      <div className="h-14 flex items-center justify-between px-6 border-b border-white/5 bg-[#070d1b]/80 backdrop-blur-sm z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-[10px] font-bold border ${avatarColor(conversation.id)}`}>
            {initials(conversation.name, conversation.phone)}
          </div>
          <div>
            <h3 className="text-[13px] font-bold text-white/90 leading-none">{conversation.name || conversation.phone}</h3>
            <p className="text-[10px] text-white/20 mt-1 uppercase font-bold tracking-widest">{conversation.sales_state.replace(/_/g, ' ')}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={onModeToggle} className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase transition-all ${
            mode === 'human' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-white/10 bg-white/5 text-white/40'
          }`}>
            {mode === 'human' ? 'Human' : 'AI'} Mode
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8 space-y-6 custom-scrollbar">
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          return (
            <div key={m.id || i} className={`flex ${isUser ? "justify-start" : "justify-end"} fade-in`}>
              <div className="max-w-[75%]">
                <div className={`text-[13px] leading-relaxed px-4 py-2.5 rounded-2xl border ${
                  isUser 
                  ? "bg-white/5 border-white/10 text-white/80 rounded-tl-none" 
                  : "bg-amber-500/10 border-amber-500/20 text-white rounded-tr-none"
                }`}>
                  {m.content}
                </div>
                <div className={`flex items-center gap-2 mt-2 px-1 ${isUser ? "justify-start" : "justify-end"}`}>
                  <span className="text-[10px] text-white/10 font-bold uppercase tracking-tight">
                    {isUser ? "Customer" : "AI Concierge"} · {fmtTime(m.created_at)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="p-6 border-t border-white/5 bg-[#070d1b]/50">
        <div className="relative group">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(input); setInput(""); } }}
            placeholder="Type message..."
            rows={1}
            className="w-full resize-none border border-white/10 bg-white/5 rounded-xl px-4 py-3.5 pr-14 text-[13px] text-white outline-none focus:border-amber-500/40 transition-all placeholder:text-white/10"
          />
          <button 
            onClick={() => { if(input.trim()) { onSend(input); setInput(""); } }}
            title="Send message"
            aria-label="Send message"
            className="absolute right-2.5 top-2.5 h-10 w-10 flex items-center justify-center rounded-lg bg-amber-500 text-[#070d1b] hover:bg-amber-400 transition-all"
          >
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CONTEXT PANEL ───────────────────────────────────────────────────────────
interface ContextPanelProps {
  conversation: Conversation | undefined;
  order: Order | null;
  followUps: FollowUp[];
  onSchedule: (msg: string, hours: number) => void;
  onConfirm: () => void;
  onHandoff: () => void;
}

function ContextPanel({ conversation, order, followUps, onSchedule, onConfirm, onHandoff }: ContextPanelProps) {
  const [msg, setMsg] = useState("Hi, just checking in on your order! 🥭");

  if (!conversation) return <div className="w-[280px] shrink-0 border-l border-white/5" />;

  return (
    <div className="w-[280px] shrink-0 border-l border-white/5 flex flex-col bg-[#070d1b]/30">
      <div className="p-5 border-b border-white/5">
        <h3 className="text-[9px] font-bold text-white/20 uppercase tracking-[0.2em] mb-4">Actions</h3>
        <div className="space-y-2">
          <button onClick={onConfirm} className="w-full h-10 rounded-xl bg-amber-500 text-[#070d1b] font-bold text-[11px] uppercase tracking-wider hover:bg-amber-400 transition-all flex items-center justify-center gap-2">
            <CheckCircle2 size={14} /> Confirm Sale
          </button>
          <button onClick={onHandoff} className="w-full h-10 rounded-xl border border-white/10 text-white/80 font-bold text-[11px] uppercase tracking-wider hover:bg-white/5 transition-all flex items-center justify-center gap-2">
            <User size={14} /> Human Handoff
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <section className="p-5 border-b border-white/5">
          <h3 className="text-[9px] font-bold text-white/20 uppercase tracking-[0.2em] mb-4">Order Context</h3>
          {!order ? <p className="text-[10px] text-white/10 italic">No order draft yet</p> : (
            <div className="space-y-4">
              <Row label="Product" value={formatOrderProduct(order)} icon={<Tag size={12}/>} />
              <Row label="Amount"  value={fmtINR(calculateOrderValue(order))} icon={<Activity size={12}/>} />
              <Row label="Address" value={order.delivery_address || 'Pending'} icon={<MapPin size={12}/>} truncate />
            </div>
          )}
        </section>

        <section className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[9px] font-bold text-white/20 uppercase tracking-[0.2em]">Follow-up</h3>
            <span className="text-[8px] px-1.5 py-0.5 rounded border border-white/5 text-white/20 font-bold">AUTO</span>
          </div>
          <textarea 
            value={msg} 
            onChange={e => setMsg(e.target.value)}
            title="Follow-up message"
            placeholder="Enter follow-up message..."
            aria-label="Follow-up message"
            className="w-full bg-white/5 border border-white/5 rounded-lg p-3 text-[11px] text-white/60 resize-none outline-none focus:border-amber-500/40 mb-3"
            rows={3}
          />
          <div className="grid grid-cols-2 gap-2 mb-6">
            <button onClick={() => onSchedule(msg, 24)} className="py-2 rounded-lg border border-white/5 text-[10px] font-bold text-white/40 hover:text-white hover:border-white/10 transition-all">IN 24H</button>
            <button onClick={() => onSchedule(msg, 48)} className="py-2 rounded-lg border border-white/5 text-[10px] font-bold text-white/40 hover:text-white hover:border-white/10 transition-all">IN 2D</button>
          </div>
          
          <div className="space-y-2">
            {followUps.filter(f => f.status === 'pending').map(f => (
              <div key={f.id} className="p-3 rounded-xl border border-white/5 bg-white/2">
                <div className="flex justify-between items-center mb-1">
                   <span className="text-[8px] font-bold text-amber-500 tracking-widest uppercase">Pending</span>
                   <span className="text-[9px] text-white/20">{relTime(f.scheduled_for)}</span>
                </div>
                <p className="text-[10px] text-white/40 italic line-clamp-2">&quot;{f.message}&quot;</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── LOGS VIEW ───────────────────────────────────────────────────────────────
function LogsView({ logs }: { logs: WebhookLog[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-12 bg-[#070d1b] fade-in">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl font-bold text-white mb-1">Audit Trail</h2>
        <p className="text-[12px] text-white/20 mb-8 uppercase tracking-widest font-bold">Live Webhook Monitoring</p>
        
        <div className="rounded-2xl border border-white/5 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/2 text-[10px] font-bold text-white/20 uppercase tracking-widest border-b border-white/5">
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Phone</th>
                <th className="px-6 py-4">Latency</th>
                <th className="px-6 py-4">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs.map(l => (
                <tr key={l.id} className="hover:bg-white/1 transition-colors">
                  <td className="px-6 py-4 flex items-center gap-3">
                    <Dot status={l.status === 'success' ? 'green' : (l.status === 'error' ? 'red' : 'amber')} />
                    <span className={`text-[11px] font-bold uppercase ${l.status === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>{l.status}</span>
                  </td>
                  <td className="px-6 py-4 text-[11px] text-white/60 font-mono">{l.phone || '—'}</td>
                  <td className="px-6 py-4 text-[11px] text-white/30 font-mono">{l.duration_ms}ms</td>
                  <td className="px-6 py-4 text-[11px] text-white/20">{new Date(l.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD APP ───────────────────────────────────────────────────────────
function DashboardApp({ onLogout }: { onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState("inbox");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);

  const conversation = useMemo(() => conversations.find(c => c.id === selectedId), [conversations, selectedId]);

  // ── apiFetch logic ────────────────────────────────────────────────────────
  const apiFetch = useCallback(async (url: string, opts?: RequestInit) => {
    const res = await fetch(url, opts);
    if (res.status === 401) {
      onLogout();
      return null;
    }
    if (!res.ok) return null;
    return res.json();
  }, [onLogout]);

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [conversationsData, audit] = await Promise.all([
        apiFetch("/api/conversations"),
        apiFetch("/api/webhook-logs"),
      ]);
      const nextConversations = Array.isArray(conversationsData)
        ? (conversationsData as Conversation[])
        : [];

      setConversations(nextConversations);
      setLogs(Array.isArray(audit) ? audit : []);
      setSelectedId((current) => {
        if (nextConversations.length === 0) {
          return null;
        }

        if (current && nextConversations.some((conversation) => conversation.id === current)) {
          return current;
        }

        return nextConversations[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    let isMounted = true;
    let channel: { unsubscribe: () => void } | null = null;

    const connectRealtime = async () => {
      await loadData();

      const { supabaseClient } = await import("@/lib/supabaseClient");

      if (!isMounted) {
        return;
      }

      channel = supabaseClient
        .channel("rt-dashboard-messages")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            const newMessage = payload.new as RealtimeMessageRow;
            setConversations((current) => mergeConversationMessage(current, newMessage));
            void loadData();
          }
        )
        .subscribe();
    };

    void connectRealtime();

    return () => {
      isMounted = false;
      if (channel) channel.unsubscribe();
    };
  }, [loadData]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }

    setMessages(
      conversations.find((currentConversation) => currentConversation.id === selectedId)?.messages ?? []
    );
  }, [conversations, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setOrder(null);
      setFollowUps([]);
      return;
    }

    apiFetch(`/api/conversations/${selectedId}/order`).then((o: Order | null) => setOrder(o || null));
    apiFetch(`/api/follow-ups?conversation_id=${selectedId}`).then((f: FollowUp[]) => setFollowUps(f || []));
  }, [selectedId, apiFetch]);
  const handleSend = async (txt: string) => {
    if (!selectedId || !txt.trim()) return;
    const optimistic: Message = { id: `opt-${Date.now()}`, role: "assistant", content: txt, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, optimistic]);
    setConversations(prev =>
      mergeConversationMessage(prev, {
        id: optimistic.id,
        conversation_id: selectedId,
        role: optimistic.role,
        content: optimistic.content,
        created_at: optimistic.created_at,
      })
    );
    await apiFetch(`/api/conversations/${selectedId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: txt }),
    });
  };

  const handleModeToggle = async () => {
    if (!selectedId || !conversation) return;
    const newMode = conversation.mode === "agent" ? "human" : "agent";
    setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, mode: newMode } : c));
    await apiFetch(`/api/conversations/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: newMode }),
    });
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    await apiFetch(`/api/conversations/${selectedId}/confirm`, { method: "POST" });
    loadData();
  };

  const handleHandoff = async () => {
    if (!selectedId) return;
    await apiFetch(`/api/conversations/${selectedId}/handoff`, { method: "POST" });
    loadData();
  };

  const handleSchedule = async (m: string, h: number) => {
    if (!selectedId) return;
    const scheduled_for = new Date(Date.now() + h * 3600000).toISOString();
    await apiFetch(`/api/conversations/${selectedId}/follow-up`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: m, scheduled_for }),
    });
    apiFetch(`/api/follow-ups?conversation_id=${selectedId}`).then((f: FollowUp[]) => setFollowUps(f || []));
  };

  return (
    <div className="flex h-screen flex-col bg-[#070d1b] text-white selection:bg-amber-500/30">
      <Header onLogout={onLogout} activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {activeTab === "inbox" ? (
          <>
            <LeadInbox conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} loading={loading} />
            <ChatPanel 
              conversation={conversation} 
              messages={messages} 
              mode={conversation?.mode || 'agent'} 
              onSend={handleSend} 
              onModeToggle={handleModeToggle}
            />
            <ContextPanel 
              conversation={conversation} 
              order={order} 
              followUps={followUps} 
              onSchedule={handleSchedule}
              onConfirm={handleConfirm}
              onHandoff={handleHandoff}
            />
          </>
        ) : (
          <LogsView logs={logs} />
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [authed, setAuthed] = useState(false);
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;
  return <DashboardApp onLogout={() => setAuthed(false)} />;
}
