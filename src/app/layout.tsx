import type { Metadata } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

interface AssistLoopWidget {
  init: (config: { agentId?: string }) => void;
}

declare global {
  interface Window {
    AssistLoopWidget?: AssistLoopWidget;
  }
}

export const metadata: Metadata = {
  title: "WhatsApp AI Agent",
  description: "WhatsApp AI Agent Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
        <Script
          src="https://assistloop.ai/assistloop-widget.js"
          strategy="afterInteractive"
          onLoad={() => {
            window.AssistLoopWidget?.init({
              agentId: process.env.NEXT_PUBLIC_ASSISTLOOP_AGENT_ID,
            });
          }}
        />
      </body>
    </html>
  );
}
