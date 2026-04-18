import type { KnowledgeArticle } from '@/backend/modules/knowledge/knowledge.types';

export const BUSINESS_KNOWLEDGE_ARTICLES: KnowledgeArticle[] = [
  {
    id: 'business-brand-story',
    domain: 'business',
    category: 'business_policy',
    title: 'Brand Story and Legacy',
    keywords: ['brand', 'legacy', '52 year', 'family', 'story', 'website'],
    content:
      'The Mango Lover Shop is a premium mango brand built on a 52-year family fruit sourcing legacy. The brand focuses on trusted Devgad Alphonso sourcing and a cleaner premium buying experience.',
    customerReply:
      'The Mango Lover Shop is built on a 52-year family fruit sourcing legacy. We focus on trusted Devgad Alphonso sourcing and a cleaner premium buying experience.',
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
      'Payment should be treated as a tracked operational step, with status taken from the order and payment records rather than guesswork. If payment is pending, the system should guide clearly without repeating the same reminder mechanically.',
    customerReply:
      'I can check the current payment status from your order and guide you accordingly. If anything needs updating, I will keep the next step clear.',
  },
  {
    id: 'business-logistics-caution',
    domain: 'business',
    category: 'business_policy',
    title: 'Perishable Logistics Caution',
    keywords: ['delivery', 'logistics', 'perishable', 'city', 'shipping', 'availability'],
    content:
      'Because the fruit is perishable, city handling and logistics should be treated carefully. Delivery guidance should follow configured rules and actual availability instead of assumptions.',
    customerReply:
      'Because the fruit is perishable, delivery handling depends on the configured city and logistics rules. I can check the current delivery guidance for your city.',
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
];
