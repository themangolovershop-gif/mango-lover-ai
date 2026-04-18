// Using globalThis.crypto which is available in Next.js/Node 18+ environments


/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Gets the admin password from environment, handling security rules.
 */
export function getAdminPassword() {
  const adminPasswordRaw = process.env.ADMIN_PASSWORD;
  
  if (!adminPasswordRaw) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[AUTH-WARN] ADMIN_PASSWORD is not set. Using insecure default 'mango123' because NODE_ENV=development.");
      return "mango123";
    }
    return null; // Fail closed in production
  }
  
  return adminPasswordRaw.trim();
}

/**
 * Simple signing helper using HMAC-SHA256 (Web Crypto API)
 */
async function getSecretKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSessionToken(payload: string): Promise<string> {
  const secret = getAdminPassword();
  if (!secret) throw new Error("ADMIN_PASSWORD not configured");

  const key = await getSecretKey(secret);
  const enc = new TextEncoder();
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  
  const b64Payload = btoa(payload);
  const b64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  return `${b64Payload}.${b64Signature}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const secret = getAdminPassword();
  if (!secret || !token.includes(".")) return false;

  try {
    const [b64Payload, b64Signature] = token.split(".");
    const payload = atob(b64Payload);
    const key = await getSecretKey(secret);
    const enc = new TextEncoder();
    
    const signature = new Uint8Array(
      atob(b64Signature)
        .split("")
        .map((c) => c.charCodeAt(0))
    );

    return await crypto.subtle.verify("HMAC", key, signature, enc.encode(payload));
  } catch {
    return false;
  }
}
