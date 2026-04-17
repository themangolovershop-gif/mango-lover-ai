import Link from "next/link";

export default function Home() {
  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-[#0A0A0A] text-white selection:bg-orange-500/30">
      {/* Decorative Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-600/20 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-yellow-600/10 blur-[150px] rounded-full" />

      {/* Content wrapper */}
      <div className="relative z-10 max-w-4xl px-6 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-8 text-sm font-medium border rounded-full border-white/10 bg-white/5 backdrop-blur-md animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          System Live & Operational
        </div>

        {/* Hero Title */}
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent animate-in fade-in slide-in-from-bottom-8 duration-700">
          🥭 Mango Lover <br />
          <span className="bg-gradient-to-r from-orange-400 via-yellow-400 to-orange-500 bg-clip-text text-transparent">
            WhatsApp AI Concierge
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-neutral-400 max-w-2xl mx-auto mb-10 animate-in fade-in slide-in-from-bottom-10 duration-1000">
          Experience the future of farm-to-table sales. Our AI agent is now handling orders, 
          pricing, and delivery inquiries for your premium Devgad Alphonso collection.
        </p>

        {/* Call to action */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center animate-in fade-in slide-in-from-bottom-12 duration-1000">
          <Link
            href="/dashboard"
            className="group relative px-8 py-4 bg-white text-black font-semibold rounded-xl transition-all hover:scale-105 active:scale-95 overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-yellow-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="relative group-hover:text-black">Open Control Dashboard</span>
          </Link>
          
          <div className="px-8 py-4 border border-white/10 bg-white/5 backdrop-blur-md font-semibold rounded-xl text-neutral-300">
            v1.0 Production
          </div>
        </div>
      </div>

      {/* Footer / Status details */}
      <div className="absolute bottom-12 w-full px-6 flex flex-col sm:flex-row items-center justify-between text-xs text-neutral-500 font-mono tracking-widest uppercase">
        <div className="mb-4 sm:mb-0">Powered by OpenAI & OpenRouter</div>
        <div className="flex gap-6">
          <span>Meta API: Connected</span>
          <span>Supabase: Online</span>
        </div>
      </div>
    </main>
  );
}
