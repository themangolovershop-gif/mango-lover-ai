import type { Metadata } from "next";
import { AssistLoopWidget } from "@/components/AssistLoopWidget";
import "./globals.css";

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
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
        <AssistLoopWidget />
      </body>
    </html>
  );
}
