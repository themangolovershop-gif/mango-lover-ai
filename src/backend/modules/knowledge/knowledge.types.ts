export type KnowledgeDomain = 'mango' | 'business';

export type KnowledgeCategory =
  | 'mango_variety'
  | 'ripening'
  | 'storage'
  | 'quality'
  | 'season'
  | 'recommendation'
  | 'gifting'
  | 'business_policy';

export type KnowledgeArticle = {
  id: string;
  domain: KnowledgeDomain;
  category: KnowledgeCategory;
  title: string;
  keywords: string[];
  content: string;
  customerReply: string;
};
