import React from "react";

interface MetricCardProps {
  label: string;
  value: string;
  subtext: string;
  icon: React.ReactNode;
  tone?: "emerald" | "blue" | "amber" | "rose" | "violet" | "neutral";
}

export function MetricCard(props: MetricCardProps) {
  const toneClass =
    props.tone === "emerald"
      ? "bg-emerald-500/10 border-emerald-500/15 text-emerald-400"
      : props.tone === "blue"
        ? "bg-blue-500/10 border-blue-500/15 text-blue-400"
        : props.tone === "amber"
          ? "bg-amber-500/10 border-amber-500/15 text-amber-400"
          : props.tone === "rose"
            ? "bg-rose-500/10 border-rose-500/15 text-rose-400"
            : props.tone === "violet"
              ? "bg-violet-500/10 border-violet-500/15 text-violet-400"
              : "bg-white/5 border-white/10 text-white/50";

  return (
    <div className={`glass animate-in rounded-2xl border p-5 transition-all duration-300 hover:scale-[1.01] hover:bg-white/3`}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] uppercase tracking-[0.25em] text-white/40 font-bold">{props.label}</p>
        <div className={`p-2 rounded-xl ${toneClass}`}>{props.icon}</div>
      </div>
      <p className="text-3xl font-bold text-white tracking-tight">{props.value}</p>
      <p className="mt-1 text-[11px] text-white/20 font-medium">{props.subtext}</p>
    </div>
  );
}
