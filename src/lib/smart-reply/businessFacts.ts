import "server-only";

import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { BRAND_CONTEXT } from "@/backend/shared/constants/brand";
import { DEFAULT_SALES_SETTINGS } from "@/lib/sales-settings";

const FACTS_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedFacts:
  | {
      value: string;
      expiresAt: number;
    }
  | null = null;

function formatInr(value: number) {
  return `INR ${Math.round(value)}`;
}

function buildCatalogLine(args: { medium: number; large: number; jumbo: number }) {
  return `Current premium mango availability: Medium ${formatInr(args.medium)} (${BRAND_CONTEXT.products.weights.medium}), Large ${formatInr(args.large)} (${BRAND_CONTEXT.products.weights.large}), Jumbo ${formatInr(args.jumbo)} (${BRAND_CONTEXT.products.weights.jumbo}).`;
}

function buildBusinessFactsBlock(args: { medium: number; large: number; jumbo: number }) {
  const primaryCities = DEFAULT_SALES_SETTINGS.logistics.primaryCities.join(", ");
  const serviceRegions = DEFAULT_SALES_SETTINGS.logistics.serviceRegions.join(", ");

  return `## LIVE BUSINESS FACTS

- Brand base location: ${BRAND_CONTEXT.location}.
- Verified visit address: ${BRAND_CONTEXT.visitAddress}.
- Website: ${BRAND_CONTEXT.website}.
- Order online: ${BRAND_CONTEXT.orderUrl}.
- ${buildCatalogLine(args)}
- Primary service cities: ${primaryCities}.
- Wider service regions configured: ${serviceRegions}.
- Mumbai delivery target: ${BRAND_CONTEXT.logistics.mumbaiDeliveryWindow}.
- Air courier target for ${BRAND_CONTEXT.logistics.metroAirCourierCoverage}: ${BRAND_CONTEXT.logistics.metroAirCourierWindow}.
- Reference courier charge: INR ${BRAND_CONTEXT.logistics.referenceCourierChargePerKg} per kg. This is guidance, not a final quote.
- Payment mode: ${DEFAULT_SALES_SETTINGS.payment.mode}. Ask for payment reference or screenshot after transfer.
- If the customer asks for store location, you may share the verified visit address exactly as written above.
- If the customer asks for pickup or visit timing, share the address but confirm operational timing before making a hard pickup promise.
- If the customer asks about delivery timing, you may mention the Mumbai 24-hour target and metro 2-day air courier target, but avoid overpromising exact timing if the cutoff or batch is unclear.
- If the customer asks about courier charges, you may share INR ${BRAND_CONTEXT.logistics.referenceCourierChargePerKg} per kg as the current reference charge, but explain that the final total can still depend on quantity, city, and handling.
- If the customer asks for a final quote, explain that the exact total can depend on quantity, city, and delivery handling.
- If the customer asks about availability, explain that premium Alphonso moves in curated seasonal batches and the current batch is limited. Do not say "today's fresh harvest" unless an operator explicitly confirms it that day.`;
}

export async function getSmartReplyBusinessFacts() {
  if (cachedFacts && cachedFacts.expiresAt > Date.now()) {
    return cachedFacts.value;
  }

  try {
    const prisma = getPrismaClient();
    const products = await prisma.product.findMany({
      where: {
        active: true,
      },
      select: {
        size: true,
        price: true,
      },
    });

    const medium =
      Number(products.find((product) => product.size === "MEDIUM")?.price?.toString()) ||
      DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "medium")?.price ||
      1199;
    const large =
      Number(products.find((product) => product.size === "LARGE")?.price?.toString()) ||
      DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "large")?.price ||
      1499;
    const jumbo =
      Number(products.find((product) => product.size === "JUMBO")?.price?.toString()) ||
      DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "jumbo")?.price ||
      1999;

    const value = buildBusinessFactsBlock({ medium, large, jumbo });
    cachedFacts = {
      value,
      expiresAt: Date.now() + FACTS_CACHE_TTL_MS,
    };
    return value;
  } catch (error) {
    console.warn("[SmartReply] Failed to load live business facts, using static fallback.", error);
    return buildBusinessFactsBlock({
      medium:
        DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "medium")?.price || 1199,
      large:
        DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "large")?.price || 1499,
      jumbo:
        DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "jumbo")?.price || 1999,
    });
  }
}
