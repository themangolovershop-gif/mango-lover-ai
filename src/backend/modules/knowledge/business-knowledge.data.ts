import type { KnowledgeArticle } from '@/backend/modules/knowledge/knowledge.types';

export const BUSINESS_KNOWLEDGE_ARTICLES: KnowledgeArticle[] = [
  {
    id: 'business-brand-story',
    domain: 'business',
    category: 'business_policy',
    title: 'Brand Story and Legacy',
    keywords: ['brand', 'legacy', '52 year', 'family', 'story', 'website'],
    content:
      'The Mango Lover Shop (themangolovershop.in) is a premium mango brand based in Thane, Maharashtra, built on a 52-year family fruit sourcing legacy. We focus on authentic GI-tagged Devgad Alphonso and a cleaner premium buying experience.',
    customerReply:
      'The Mango Lover Shop is based in Thane, Maharashtra, and built on a 52-year family fruit sourcing legacy. You can find more about us at themangolovershop.in.',
  },
  {
    id: 'business-product-promise',
    domain: 'business',
    category: 'business_policy',
    title: 'Product Promise',
    keywords: ['gi tagged', 'gi-tagged', 'devgad only', 'naturally ripened', 'carbide free', 'promise'],
    content:
      'The Mango Lover Shop represents premium GI-tagged Devgad Alphonso that is naturally ripened and carbide-free. The business specializes in Devgad only rather than selling multiple Alphonso origins.',
    customerReply:
      'We focus on premium GI-tagged Devgad Alphonso only, and the fruit is naturally ripened and carbide-free. That is one of our core quality commitments.',
  },
  {
    id: 'business-premium-positioning',
    domain: 'business',
    category: 'business_policy',
    title: 'Premium Positioning',
    keywords: ['premium', 'expensive', 'why premium', 'price', 'quality over mass'],
    content:
      'The brand positions itself around curated quality, consistency, and premium experience rather than bargain pricing. It is not designed as a mass-market fruit seller competing only on the lowest price.',
    customerReply:
      'We focus more on curated quality and consistency than bargain pricing. Customers usually choose us for trusted Devgad quality, natural ripening, and a more premium experience.',
  },
  {
    id: 'business-payment-guidance',
    domain: 'business',
    category: 'business_policy',
    title: 'Payment Handling Guidance',
    keywords: ['payment', 'upi', 'reference', 'screenshot', 'payment instructions'],
    content:
      'Payment is handled via manual UPI transfer. Once the payment is made, the customer must share a screenshot or transaction reference number for verification.',
    customerReply:
      'Perfect. Please share the payment reference or screenshot here, and I will guide the next step clearly.',
  },
  {
    id: 'business-logistics-caution',
    domain: 'business',
    category: 'business_policy',
    title: 'Perishable Logistics Caution',
    keywords: ['delivery', 'logistics', 'perishable', 'city', 'shipping', 'availability'],
    content:
      'The brand is based in Thane, Maharashtra. Primary delivery cities are Mumbai, Thane, and Navi Mumbai. Wider service regions include all of India, but exact delivery guidance depends on the city and the current seasonal batch.',
    customerReply:
      'We are based in Thane, Maharashtra, and our primary delivery cities are Mumbai, Thane, and Navi Mumbai. We also handle wider service regions, but exact delivery guidance depends on your city and the current batch.',
  },
  {
    id: 'business-customer-handling',
    domain: 'business',
    category: 'business_policy',
    title: 'Customer Handling Principles',
    keywords: ['short replies', 'premium', 'repeat', 'restart', 'edit', 'order summary'],
    content:
      'The assistant should answer the latest customer question first, keep replies short and premium, avoid repetition, and support edits, restarts, and order summaries naturally. Deterministic checkout rules still take priority when operational accuracy matters.',
    customerReply:
      'I will keep the reply short, clear, and focused on your latest question first. If you want to edit or restart the order, I can guide that naturally.',
  },
  {
    id: 'business-replacement-policy',
    domain: 'business',
    category: 'business_policy',
    title: 'Replacement and Quality Policy',
    keywords: ['replacement', 'refund', 'damage', 'spoiled', 'bad mango', 'quality issue'],
    content:
      'If any fruit is damaged during transit or found spoiled within 24 hours of delivery, we provide a replacement or credit. As Alphonso is a natural product, we ask for a photo of the affected fruit to help us improve our sourcing and packaging.',
    customerReply:
      'We stand by our quality. If you find any damaged or spoiled fruit within 24 hours of delivery, just share a photo and we will arrange a replacement or credit for you.',
  },
  {
    id: 'business-shop-location',
    domain: 'business',
    category: 'business_policy',
    title: 'Shop Location and Pickup',
    keywords: ['location', 'address', 'shop', 'visit', 'pickup', 'where'],
    content:
      'The brand is based in Thane, Maharashtra. We do not provide a specific street address unless operationally confirmed for a pickup or visit. Pickup should not be promised unless active.',
    customerReply:
      'The Mango Lover Shop is based in Thane, Maharashtra. If you need exact visit or pickup logistics, we should confirm that operationally before I promise anything specific.',
  },
  {
    id: 'business-bulk-orders',
    domain: 'business',
    category: 'business_policy',
    title: 'Bulk and Wedding Orders',
    keywords: ['bulk', 'wedding', 'corporate', 'wholesale', 'large quantity'],
    content:
      'Bulk orders for weddings or corporate gifting are supported. The customer should provide size, quantity, and delivery city for a custom quote and batch logistics.',
    customerReply:
      'Yes, we can handle bulk requirements. For something like weddings or corporate gifting, the cleanest next step is size, quantity, and delivery city so we can guide the right batch and logistics.',
  },
  {
    id: 'business-how-to-order',
    domain: 'business',
    category: 'business_policy',
    title: 'How to Place Order',
    keywords: ['order', 'place order', 'how to', 'steps'],
    content:
      'Ordering follows a step-by-step flow: size, quantity, delivery address, delivery date, and payment confirmation.',
    customerReply:
      'Once you are ready, I will guide you step by step. Usually the clean flow is size, quantity, delivery address, delivery date, and then payment confirmation.',
  },
];
