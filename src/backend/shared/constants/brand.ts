export const BRAND_CONTEXT = {
  name: "The Mango Lover Shop",
  website: "themangolovershop.in",
  orderUrl: "https://www.themangolovershop.in",
  location: "Thane, Maharashtra",
  visitAddress: "1st Floor, The Walk, Hiranandani Estate, Thane, Mumbai",
  legacy: "52-year family fruit sourcing legacy",
  logistics: {
    mumbaiDeliveryWindow: "24 hours",
    metroAirCourierWindow: "2 days",
    metroAirCourierCoverage: "All Metro Cities",
    referenceCourierChargePerKg: 130,
  },
  products: {
    origin: "Authentic GI-tagged Devgad Alphonso mangoes",
    ripening: "Naturally ripened, carbide-free",
    sizes: {
      medium: "Ideal for individual consumption",
      large: "Perfect for family treats",
      jumbo: "The premium export-quality choice"
    },
    weights: {
      medium: "181-220g per mango",
      large: "221-260g per mango",
      jumbo: "261-300g per mango",
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
