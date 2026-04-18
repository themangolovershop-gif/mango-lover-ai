"use client";

import { useState } from "react";

export function WebChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{role: string, content: string}[]>([]);
  const [input, setInput] = useState("");

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const newMsg = { role: "user", content: input };
    setMessages([...messages, newMsg]);
    setInput("");

    // Call /api/omnichannel/webchat
    const res = await fetch("/api/omnichannel/webchat", {
      method: "POST",
      body: JSON.stringify({ text: input }),
      headers: { "Content-Type": "application/json" }
    });
    
    const data = await res.json();
    if (data.reply) {
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {!isOpen && (
        <button 
          onClick={() => setIsOpen(true)}
          className="bg-orange-500 text-white p-4 rounded-full shadow-lg hover:bg-orange-600 transition-all transform hover:scale-105"
        >
          🍐 Chat with Mango Expert
        </button>
      )}

      {isOpen && (
        <div className="bg-white w-80 h-96 rounded-xl shadow-2xl flex flex-col border border-orange-100 overflow-hidden">
          <div className="bg-orange-500 p-4 text-white font-bold flex justify-between items-center">
            <span>Mango Lover AI</span>
            <button onClick={() => setIsOpen(false)} className="text-white hover:text-orange-200">×</button>
          </div>
          
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-orange-50/30">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`p-3 rounded-lg max-w-[80%] text-sm ${
                  m.role === "user" ? "bg-orange-500 text-white" : "bg-white text-gray-800 shadow-sm"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-orange-100">
            <div className="flex gap-2">
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask about Alphonso..."
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button 
                onClick={handleSend}
                className="bg-orange-500 text-white px-3 py-2 rounded-lg text-sm"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
