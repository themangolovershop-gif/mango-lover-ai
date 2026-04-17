import { WebhookLog } from "@/lib/types";
import { AlertCircle, CheckCircle2, Clock, Search } from "lucide-react";

interface SystemLogsProps {
  logs: WebhookLog[];
}

export function SystemLogs({ logs }: SystemLogsProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0 animate-in p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">System Logs</h2>
          <p className="text-sm text-white/40 mt-1 italic">Real-time audit of webhook events and signature verification.</p>
        </div>
        <div className="flex items-center gap-4">
           <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-2">
             <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
             Live Stream
           </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden border border-border glass rounded-2xl flex flex-col">
        <div className="bg-white/5 border-b border-border p-4 flex items-center gap-4">
          <div className="bg-white/5 border border-border rounded-lg px-3 py-1.5 flex items-center gap-2 flex-1">
             <Search size={14} className="text-white/20" />
             <input type="text" placeholder="Filter by phone or status..." className="bg-transparent border-none text-xs focus:ring-0 w-full placeholder:text-white/20" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {logs.length === 0 ? (
            <div className="p-20 text-center text-white/20 italic text-sm">No operational logs recorded yet.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-background/95 backdrop-blur-md z-10">
                <tr className="border-b border-border">
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30">Timestamp</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30">Identifier</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30">Status</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-white/30">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/2 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Clock size={12} className="text-white/20" />
                        <span className="text-[11px] font-mono text-white/60">{new Date(log.created_at).toLocaleTimeString()}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-bold text-white/80">{log.phone || log.whatsapp_msg_id || 'System'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase ${
                        log.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {log.status === 'success' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                        {log.status}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[11px] text-white/40">{log.duration_ms ? `${log.duration_ms}ms` : '-'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
