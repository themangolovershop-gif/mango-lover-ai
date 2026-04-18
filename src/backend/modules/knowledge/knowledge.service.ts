import { BUSINESS_KNOWLEDGE_ARTICLES } from '@/backend/modules/knowledge/business-knowledge.data';
import { MANGO_KNOWLEDGE_ARTICLES } from '@/backend/modules/knowledge/mango-knowledge.data';
import type { KnowledgeArticle, KnowledgeDomain } from '@/backend/modules/knowledge/knowledge.types';
import { normalizeMessage } from '@/backend/shared/utils/normalization';

function tokenize(query: string) {
  return Array.from(
    new Set(
      normalizeMessage(query)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
    )
  );
}

function scoreArticle(article: KnowledgeArticle, tokens: string[]) {
  const haystack = `${article.title} ${article.content} ${article.keywords.join(' ')}`.toLowerCase();

  return tokens.reduce((score, token) => {
    if (article.keywords.some((keyword) => keyword.toLowerCase().includes(token))) {
      return score + 4;
    }

    if (article.title.toLowerCase().includes(token)) {
      return score + 3;
    }

    if (haystack.includes(token)) {
      return score + 1;
    }

    return score;
  }, 0);
}

function getArticles(domain: KnowledgeDomain) {
  return domain === 'mango' ? MANGO_KNOWLEDGE_ARTICLES : BUSINESS_KNOWLEDGE_ARTICLES;
}

function searchKnowledge(domain: KnowledgeDomain, query: string, limit = 3) {
  const tokens = tokenize(query);
  const articles = getArticles(domain);

  const ranked = articles
    .map((article) => ({
      article,
      score: tokens.length > 0 ? scoreArticle(article, tokens) : 0,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ article }) => article);

  if (ranked.length > 0) {
    return ranked;
  }

  return articles.slice(0, limit);
}

export function searchMangoKnowledge(query: string, limit = 3) {
  return searchKnowledge('mango', query, limit);
}

export function searchBusinessKnowledge(query: string, limit = 3) {
  return searchKnowledge('business', query, limit);
}

export function summarizeKnowledgeResults(articles: KnowledgeArticle[]) {
  return articles.map((article) => `${article.title}: ${article.content}`);
}
