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

function buildCatalogLine(args: {
  medium: number;
  mediumCorp: number;
  large: number;
  largeCorp: number;
  jumbo: number;
  jumboCorp: number;
}) {
  return `Current premium mango availability and pricing (per dozen box):
- Medium (M) (${BRAND_CONTEXT.products.weights.medium}): Retail ${formatInr(args.medium)}, Corporate/Bulk ${formatInr(args.mediumCorp)}+
- Large (L) (${BRAND_CONTEXT.products.weights.large}): Retail ${formatInr(args.large)}, Corporate/Bulk ${formatInr(args.largeCorp)}+
- Jumbo (J) (${BRAND_CONTEXT.products.weights.jumbo}): Retail ${formatInr(args.jumbo)}, Corporate/Bulk ${formatInr(args.jumboCorp)}+

Note: Corporate/Bulk prices apply for orders of 10 or more boxes.`;
}

function buildBusinessFactsBlock(args: {
  medium: number;
  mediumCorp: number;
  large: number;
  largeCorp: number;
  jumbo: number;
  jumboCorp: number;
}) {
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
        corporatePrice: true,
      },
    });

    const mediumProduct = products.find((product) => product.size === "MEDIUM");
    const largeProduct = products.find((product) => product.size === "LARGE");
    const jumboProduct = products.find((product) => product.size === "JUMBO");

    const medium = Number(mediumProduct?.price?.toString()) || 1499;
    const mediumCorp = Number(mediumProduct?.corporatePrice?.toString()) || 2999;

    const large = Number(largeProduct?.price?.toString()) || 1999;
    const largeCorp = Number(largeProduct?.corporatePrice?.toString()) || 3499;

    const jumbo = Number(jumboProduct?.price?.toString()) || 2499;
    const jumboCorp = Number(jumboProduct?.corporatePrice?.toString()) || 3999;

    const value = buildBusinessFactsBlock({
      medium,
      mediumCorp,
      large,
      largeCorp,
      jumbo,
      jumboCorp,
    });
    cachedFacts = {
      value,
      expiresAt: Date.now() + FACTS_CACHE_TTL_MS,
    };
    return value;
  } catch (error) {
    console.warn("[SmartReply] Failed to load live business facts, using static fallback.", error);
    return buildBusinessFactsBlock({
      medium: 1499,
      mediumCorp: 2999,
      large: 1999,
      largeCorp: 3499,
      jumbo: 2499,
      jumboCorp: 3999,
    });
  }
}
