import { Order, FollowUp, ConversationWithLastMessage } from "@/lib/types";
import { calculateOrderValue, sizeLabel } from "@/lib/sales-analytics";
import { ShoppingCart, Calendar, Clock, MapPin, Tag, ArrowUpRight, History } from "lucide-react";

interface ContextPanelProps {
  order: Order | null;
  conversation: ConversationWithLastMessage | null;
  followUps: FollowUp[];
  onScheduleFollowUp: (msg: string, delayLabel: string) => void;
  formatCurrency: (val: number) => string;
  formatRelativeTime: (date: string) => string;
}

export function ContextPanel({
  order,
  conversation,
  followUps,
  onScheduleFollowUp,
  formatCurrency,
  formatRelativeTime
}: ContextPanelProps) {
  if (!conversation) return null;

  const orderSummary = order?.product_size
    ? `${order.quantity ?? "-"} box ${sizeLabel(order.product_size)}`
    : "Order details pending";

  return (
    <div className="w-[320px] border-l border-border glass p-6 overflow-y-auto custom-scrollbar flex flex-col gap-8 shrink-0">
      {/* Lead Metadata */}
      <section>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-4 flex items-center gap-2">
          <Tag size={12} /> Lead Profile
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/40">Status</span>
            <span className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[10px] text-primary font-bold uppercase">
              {conversation.sales_state.replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/40">Intent</span>
            <span className="text-xs text-white/80 font-medium">
              {conversation.lead_tag || 'Interested'}
            </span>
          </div>
        </div>
      </section>

      {/* Order Context */}
      <section>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-4 flex items-center gap-2">
          <ShoppingCart size={12} /> Current Order
        </h3>
        {!order ? (
          <div className="rounded-xl border border-white/5 bg-white/2 p-4 text-center">
            <p className="text-xs text-white/20 italic">No active order drafted</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-white/50">DRAFT ORDER</span>
                <span className="text-[11px] font-bold text-primary">
                  {formatCurrency(calculateOrderValue(order))}
                </span>
              </div>
              <p className="text-[13px] font-bold text-white leading-tight">{orderSummary}</p>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <MapPin size={14} className="text-white/20 mt-0.5" />
                <div className="min-w-0">
                   <p className="text-[10px] uppercase font-bold text-white/20">Delivery Address</p>
                   <p className="text-[11px] text-white/60 leading-tight">
                     {order.delivery_address || 'Not provided'}
                   </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar size={14} className="text-white/20 mt-0.5" />
                <div className="min-w-0">
                   <p className="text-[10px] uppercase font-bold text-white/20">Requested Date</p>
                   <p className="text-[11px] text-white/60">
                     {order.delivery_date ? formatRelativeTime(order.delivery_date) : 'Flexible'}
                   </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Follow-up / Recovery */}
      <section className="mt-auto">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-4 flex items-center gap-2">
          <History size={12} /> Recovery Sequence
        </h3>
        <div className="space-y-3">
          {followUps.filter(f => f.status === 'pending').map(f => (
            <div key={f.id} className="p-3 rounded-lg border border-white/5 bg-white/2 relative group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-white/40 flex items-center gap-1.5">
                  <Clock size={10} /> {formatRelativeTime(f.scheduled_for)}
                </span>
                <span className="text-[9px] uppercase font-bold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  Active
                </span>
              </div>
              <p className="text-[11px] text-white/60 line-clamp-2 leading-relaxed italic">
                &ldquo;{f.message}&rdquo;
              </p>
            </div>
          ))}
          
          <button 
            onClick={() => onScheduleFollowUp("Checking back on your order!", "24")}
            className="w-full py-2.5 rounded-xl border border-dashed border-white/10 hover:border-primary/50 hover:bg-primary/5 transition-all text-[11px] font-bold text-white/30 hover:text-primary flex items-center justify-center gap-2"
          >
            <ArrowUpRight size={14} />
            SCHEDULE NUDGE
          </button>
        </div>
      </section>
    </div>
  );
}
