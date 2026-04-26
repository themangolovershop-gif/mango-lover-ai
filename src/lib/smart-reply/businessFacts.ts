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
  return `Current base catalog pricing: Medium ${formatInr(args.medium)}, Large ${formatInr(args.large)}, Jumbo ${formatInr(args.jumbo)}.`;
}

function buildBusinessFactsBlock(args: { medium: number; large: number; jumbo: number }) {
  const primaryCities = DEFAULT_SALES_SETTINGS.logistics.primaryCities.join(", ");
  const serviceRegions = DEFAULT_SALES_SETTINGS.logistics.serviceRegions.join(", ");

  return `## LIVE BUSINESS FACTS

- Brand base location: ${BRAND_CONTEXT.location}.
- Website: ${BRAND_CONTEXT.website}.
- ${buildCatalogLine(args)}
- Primary service cities: ${primaryCities}.
- Wider service regions configured: ${serviceRegions}.
- Payment mode: ${DEFAULT_SALES_SETTINGS.payment.mode}. Ask for payment reference or screenshot after transfer.
- If the customer asks for exact store address or pickup, do not invent a street address. You may say the brand is based in ${BRAND_CONTEXT.location} and confirm the exact logistics before promising pickup.
- If the customer asks for a final quote, explain that the exact total can depend on quantity, city, and delivery handling.
- If the customer asks about availability, explain that premium Alphonso moves in curated seasonal batches and can close early during peak demand.`;
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
      1499;
    const large =
      Number(products.find((product) => product.size === "LARGE")?.price?.toString()) ||
      DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "large")?.price ||
      1999;
    const jumbo =
      Number(products.find((product) => product.size === "JUMBO")?.price?.toString()) ||
      DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "jumbo")?.price ||
      2499;

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
        DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "medium")?.price || 1499,
      large:
        DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "large")?.price || 1999,
      jumbo:
        DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === "jumbo")?.price || 2499,
    });
  }
}
