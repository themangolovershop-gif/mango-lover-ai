import type { ProductSize } from "@/lib/types";

export type CatalogProduct = {
  size: ProductSize;
  name: string;
  subtitle: string;
  price: number;
  idealFor: string;
};

export type SalesSettings = {
  brand: {
    businessName: string;
    assistantName: string;
    origin: string;
    legacyNote: string;
    tone: string;
    languageModes: string[];
    promises: string[];
  };
  logistics: {
    primaryCities: string[];
    serviceRegions: string[];
    batchNote: string;
  };
  followUp: {
    maxAttempts: number;
  };
  thresholds: {
    bulkQuantity: number;
    corporateQuantity: number;
    vipOrderValue: number;
    autoHandoffConfidenceFloor: number;
  };
  payment: {
    mode: string;
    verificationPrompt: string;
  };
  catalog: CatalogProduct[];
};

function readPriceEnv(key: string, fallback: number) {
  const raw = process.env[key];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const DEFAULT_SALES_SETTINGS: SalesSettings = {
  brand: {
    businessName: process.env.BUSINESS_NAME?.trim() || "The Mango Lover Shop",
    assistantName:
      process.env.BUSINESS_ASSISTANT_NAME?.trim() || "The Mango Lover Shop Concierge",
    origin: "Authentic GI-tagged Devgad Alphonso mangoes.",
    legacyNote: "52-year family legacy.",
    tone: "Premium, polished, confident, and concise.",
    languageModes: ["English", "Hinglish", "short buyer-style text"],
    promises: [
      "Naturally ripened",
      "Carbide-free",
      "Curated premium batches",
    ],
  },
  logistics: {
    primaryCities: ["Mumbai", "Thane", "Navi Mumbai"],
    serviceRegions: ["Mumbai", "Thane", "Navi Mumbai", "All India"],
    batchNote:
      "Availability is managed in curated seasonal batches and can close early during peak demand.",
  },
  followUp: {
    maxAttempts: 3,
  },
  thresholds: {
    bulkQuantity: 10,
    corporateQuantity: 20,
    vipOrderValue: 20000,
    autoHandoffConfidenceFloor: 0.45,
  },
  payment: {
    mode: "manual_upi",
    verificationPrompt:
      "Please share the payment reference or screenshot here once the transfer is done.",
  },
  catalog: [
    {
      size: "medium",
      name: "Medium",
      subtitle: "Balanced everyday box",
      price: readPriceEnv("PRODUCT_PRICE_MEDIUM", 1199),
      idealFor: "smaller households and first orders",
    },
    {
      size: "large",
      name: "Large",
      subtitle: "Most popular premium pick",
      price: readPriceEnv("PRODUCT_PRICE_LARGE", 1499),
      idealFor: "families and repeat buyers",
    },
    {
      size: "jumbo",
      name: "Jumbo",
      subtitle: "Best suited for gifting and premium orders",
      price: readPriceEnv("PRODUCT_PRICE_JUMBO", 1999),
      idealFor: "gifting, VIP orders, and premium presentation",
    },
  ],
};

export function getCatalogProduct(size: ProductSize) {
  return DEFAULT_SALES_SETTINGS.catalog.find((product) => product.size === size);
}

export function getCatalogPrice(size: ProductSize) {
  return getCatalogProduct(size)?.price ?? 0;
}

export function buildCatalogPricingLines() {
  return DEFAULT_SALES_SETTINGS.catalog.map((product) => {
    return `${product.name} - Rs ${product.price} (${product.subtitle})`;
  });
}

export function estimateCatalogOrderValue(
  size: ProductSize | null | undefined,
  quantity: number | null | undefined
) {
  if (!size || !quantity) return 0;
  return getCatalogPrice(size) * quantity;
}
