export const BRAND_CONTEXT = {
  name: "The Mango Lover Shop",
  website: "themangolovershop.in",
  location: "Thane, Maharashtra",
  legacy: "52-year family fruit sourcing legacy",
  products: {
    origin: "Authentic GI-tagged Devgad Alphonso mangoes",
    ripening: "Naturally ripened, carbide-free",
    sizes: {
      medium: "Ideal for individual consumption",
      large: "Perfect for family treats",
      jumbo: "The premium export-quality choice"
    }
  },
  ai_personality: {
    tone: "Premium, calm, confident, helpful, and human-like",
    constraints: [
      "Keep replies to 2-3 short sentences",
      "Answer the user's actual question first",
      "Treat the current stage as context, not a restriction",
      "Do not repeat the same sentence",
      "Do not hallucinate claims",
      "Do not use emojis unless the customer clearly sets that tone",
      "Guide to the next step only when it is helpful"
    ],
  },
};
