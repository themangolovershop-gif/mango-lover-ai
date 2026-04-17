import "server-only";
import type { InteractiveButton } from "@/lib/types";

/**
 * Meta WhatsApp Cloud API helper
 */
export async function sendWhatsAppMessage(to: string, body: string, buttons?: InteractiveButton[]) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error(
      "Missing WhatsApp credentials. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID."
    );
  }

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

  console.log("[WH-INFO] Sending outbound WhatsApp message", {
    to,
    hasToken: !!token,
    hasPhoneNumberId: !!phoneNumberId,
    hasButtons: !!buttons?.length,
  });

  const payload = buttons && buttons.length > 0 && buttons.length <= 3
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          action: {
            buttons: buttons.map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.title.substring(0, 20) },
            })),
          },
        },
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body },
      };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    let data: { error?: { message?: string }; messages?: Array<{ id?: string }> } | null = null;

    if (raw) {
      try {
        data = JSON.parse(raw) as { error?: { message?: string }; messages?: Array<{ id?: string }> };
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      console.error("[WH-ERROR] Meta API rejected outbound message", {
        status: res.status,
        error: data?.error?.message || raw || "Unknown Meta API error",
        to,
      });
      throw new Error(data?.error?.message || "WhatsApp Meta API failed");
    }

    console.log("[WH-INFO] Meta send success", {
      to,
      metaMessageId: data?.messages?.[0]?.id || null,
    });

    return data;
  } catch (error) {
    console.error("[WH-ERROR] Meta send request failed", error);
    throw error;
  }
}
