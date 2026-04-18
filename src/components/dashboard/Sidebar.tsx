import { ConversationWithLastMessage, FilterKey } from "@/lib/types";
import { Search, BarChart3, TrendingUp, ShoppingCart, CheckCircle2 } from "lucide-react";

interface SidebarProps {
  conversations: ConversationWithLastMessage[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  activeFilter: FilterKey;
  setActiveFilter: (filter: FilterKey) => void;
  loading: boolean;
  error: string | null;
  getInitials: (name: string | null, phone: string) => string;
  formatTime: (date: string) => string;
}

export function Sidebar({
  conversations,
  selectedId,
  setSelectedId,
  activeFilter,
  setActiveFilter,
  loading,
  error,
  getInitials,
  formatTime
}: SidebarProps) {
  return (
    <div className="flex w-[350px] flex-col border-r border-border glass relative z-10 shrink-0">
      <div className="px-6 py-5 border-b border-border">
        <h2 className="text-sm font-bold tracking-tight uppercase text-white/40">Inbox</h2>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/5 border border-border px-3 py-2">
          <Search size={14} className="text-white/20" />
          <input 
            type="text" 
            placeholder="Search leads..." 
            className="bg-transparent border-none text-[12px] focus:outline-none focus:ring-0 w-full placeholder:text-white/20"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 p-3 border-b border-border bg-white/1">
        {[
          { key: "all", label: "All", icon: BarChart3 },
          { key: "hot", label: "Hot", icon: TrendingUp },
          { key: "draft_orders", label: "Orders", icon: ShoppingCart },
          { key: "confirmed", label: "Won", icon: CheckCircle2 },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveFilter(key as FilterKey)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-all ${
              activeFilter === key
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-white/5 text-white/40 hover:bg-white/10"
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="p-10 text-center">
            <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-[11px] text-white/30 uppercase tracking-widest">Loading</p>
          </div>
        ) : error ? (
          <div className="p-4 m-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-[11px] text-rose-300">
            {error}
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-10 text-center text-white/20 text-xs italic">
            No leads found
          </div>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full border-b border-border/50 px-5 py-4 text-left transition-all ${
                selectedId === c.id ? "bg-primary/10 border-r-2 border-r-primary" : "hover:bg-white/5"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 border border-primary/20 text-primary text-xs font-bold ring-2 ring-background">
                    {getInitials(c.name, c.phone)}
                  </div>
                  {c.mode === "human" && (
                    <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-background bg-amber-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="truncate text-[13px] font-bold text-white/90">
                      {c.name || c.phone}
                    </span>
                    <span className="text-[9px] text-white/20 font-medium">
                      {formatTime(c.updated_at)}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-white/40 line-clamp-1">
                    {c.last_message || "No history"}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider font-bold ${
                      c.sales_state === 'confirmed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-white/30'
                    }`}>
                      {c.sales_state.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
