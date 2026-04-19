'use client';

import Script from 'next/script';

interface AssistLoopWidgetApi {
  init: (config: { agentId?: string }) => void;
}

declare global {
  interface Window {
    AssistLoopWidget?: AssistLoopWidgetApi;
  }
}

export function AssistLoopWidget() {
  return (
    <Script
      src="https://assistloop.ai/assistloop-widget.js"
      strategy="afterInteractive"
      onLoad={() => {
        window.AssistLoopWidget?.init({
          agentId: process.env.NEXT_PUBLIC_ASSISTLOOP_AGENT_ID,
        });
      }}
    />
  );
}
