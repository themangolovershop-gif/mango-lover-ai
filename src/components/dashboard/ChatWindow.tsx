import { Message, ConversationWithLastMessage } from "@/lib/types";
import { Send, User, Bot, CheckCircle2, ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";

interface ChatWindowProps {
  messages: Message[];
  conversation: ConversationWithLastMessage | null;
  input: string;
  setInput: (val: string) => void;
  sending: boolean;
  onSend: () => void;
  onConfirm: () => void;
  onHandoff: () => void;
  formatTime: (date: string) => string;
}

export function ChatWindow({
  messages,
  conversation,
  input,
  setInput,
  sending,
  onSend,
  onConfirm,
  onHandoff,
  formatTime
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-white/20">
        <div className="h-16 w-16 rounded-full bg-white/2 border border-white/5 flex items-center justify-center mb-4">
          <Send size={24} />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-[0.2em]">Select a Conversation</h3>
        <p className="mt-2 text-xs italic">Choose a lead from the inbox to start managing the sale.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background/50 h-full relative">
      {/* Thread Header */}
      <div className="h-16 border-b border-border flex items-center justify-between px-6 shrink-0 bg-background/80 backdrop-blur-md z-20">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-bold text-xs ring-1 ring-primary/20">
            {conversation.phone.slice(-2)}
          </div>
          <div>
            <h3 className="text-[14px] font-bold text-white/90 leading-tight">
              {conversation.name || conversation.phone}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`h-1.5 w-1.5 rounded-full ${conversation.mode === 'human' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <span className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">
                {conversation.mode} mode
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={onHandoff}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-300 text-[11px] font-bold hover:bg-amber-500/20 transition-all"
          >
            <User size={12} />
            HANDOFF
          </button>
          <button 
            onClick={onConfirm}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-[11px] font-bold hover:bg-emerald-500/20 transition-all"
          >
            <CheckCircle2 size={12} />
            CONFIRM ORDER
          </button>
        </div>
      </div>

      {/* Message List */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar scroll-smooth"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/20 italic text-xs">
            No message history available
          </div>
        ) : (
          messages.map((m, idx) => {
            const isUser = m.role === 'user';
            
            return (
              <div 
                key={m.id || idx} 
                className={`flex flex-col ${isUser ? 'items-start' : 'items-end'} animate-in`}
              >
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed relative ${
                  isUser 
                    ? 'bg-white/5 border border-white/10 text-white/80 rounded-bl-none' 
                    : 'bg-primary/20 border border-primary/20 text-white rounded-br-none shadow-[0_4px_20px_rgba(99,102,241,0.1)]'
                }`}>
                  {m.content}
                  <div className={`absolute -bottom-5 ${isUser ? 'left-0' : 'right-0'} flex items-center gap-1.5 text-[9px] text-white/20 font-medium whitespace-nowrap`}>
                    {m.role === 'assistant' ? <Bot size={10} /> : <User size={10} />}
                    {formatTime(m.created_at)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Reply Box */}
      <div className="p-6 border-t border-border bg-background/50">
        <div className="relative group">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            placeholder="Type your reply..."
            className="w-full h-24 bg-white/5 border border-border rounded-xl px-4 py-3 text-[13px] text-white focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-white/20 resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <button
            onClick={onSend}
            disabled={sending || !input.trim()}
            className="absolute bottom-3 right-3 h-8 w-8 rounded-lg bg-primary text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
          >
            <ArrowRight size={16} />
          </button>
        </div>
        <p className="mt-2 text-[10px] text-white/20 italic">
          Press Enter to send. Manual replies automatically switch conversation to <strong>human mode</strong>.
        </p>
      </div>
    </div>
  );
}
