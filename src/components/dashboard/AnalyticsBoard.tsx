import { ConversationWithLastMessage, Order, FollowUp, SalesState } from "@/lib/types";
import { MetricCard } from "./MetricCard";
import { TrendingUp, CheckCircle2, Activity, AlertCircle, History } from "lucide-react";

interface AnalyticsBoardProps {
  conversations: ConversationWithLastMessage[];
  funnelMetrics: { state: SalesState; count: number }[];
  confirmedRevenue: number;
  openPipelineValue: number;
  recoveryCoverage: number;
  stateAuditCount: number;
  formatCurrency: (val: number) => string;
}

export function AnalyticsBoard({
  conversations,
  funnelMetrics,
  confirmedRevenue,
  openPipelineValue,
  recoveryCoverage,
  stateAuditCount,
  formatCurrency
}: AnalyticsBoardProps) {
  return (
    <div className="flex-1 p-8 overflow-y-auto custom-scrollbar animate-in">
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight">Sales Intelligence</h2>
        <p className="text-sm text-white/40 mt-1">Deep insight into your WhatsApp sales funnel and agent performance.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 mb-8">
        <MetricCard
          label="Confirmed Revenue"
          value={formatCurrency(confirmedRevenue)}
          subtext="Total verified sales volume"
          icon={<CheckCircle2 size={16} />}
          tone="emerald"
        />
        <MetricCard
          label="Open Pipeline"
          value={formatCurrency(openPipelineValue)}
          subtext="Current potential in checkout"
          icon={<TrendingUp size={16} />}
          tone="blue"
        />
        <MetricCard
          label="Recovery Coverage"
          value={`${recoveryCoverage}%`}
          subtext="Abandoned checkouts with active nudges"
          icon={<History size={16} />}
          tone="violet"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Funnel Distribution */}
        <div className="p-6 rounded-2xl border border-border glass">
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-6 flex items-center gap-2">
            <Activity size={14} /> Funnel Distribution
          </h3>
          <div className="space-y-4">
            {funnelMetrics.map((m) => {
              const percentage = Math.round((m.count / conversations.length) * 100) || 0;
              return (
                <div key={m.state}>
                  <div className="flex justify-between items-end mb-1.5">
                    <span className="text-[11px] font-bold text-white/60 uppercase tracking-tighter">
                      {m.state.replace('_', ' ')}
                    </span>
                    <span className="text-[11px] font-mono text-white/40">{m.count} leads</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary/40 rounded-full transition-all duration-1000" 
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Technical Health */}
        <div className="p-6 rounded-2xl border border-border glass flex flex-col">
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-6 flex items-center gap-2">
            <AlertCircle size={14} /> Pipeline Integrity
          </h3>
          <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
             <div className="text-4xl font-bold text-white mb-2">{stateAuditCount}</div>
             <p className="text-sm text-white/40 italic px-8">
               {stateAuditCount === 0 
                ? "Agent conversation states are perfectly matched with latest order objects." 
                : "Mismatches detected between lead state and current order data."}
             </p>
             {stateAuditCount > 0 && (
               <div className="mt-6 px-4 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[10px] text-rose-400 font-bold uppercase tracking-widest">
                 Requires Attention
               </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}
