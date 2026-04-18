import OpenAI from 'openai';
import { AIProvider } from './provider';
import { env } from '../../config/env';

export class OpenRouterProvider implements AIProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: env.OPENROUTER_API_KEY || env.OPENAI_API_KEY,
      defaultHeaders: {
        'HTTP-Referer': env.APP_BASE_URL,
        'X-Title': 'The Mango Lover Shop AI',
      },
    });
  }

  async generateCompletion(prompt: string, options: Record<string, unknown> = {}): Promise<string> {
    try {
      console.log(`[AI] Requesting completion for model: ${env.AI_MODEL}`);
      const temperature =
        typeof options.temperature === 'number' ? options.temperature : 0.7;
      const maxTokens =
        typeof options.max_tokens === 'number' ? options.max_tokens : 150;

      const response = await this.client.chat.completions.create({
        model: env.AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
      });

      const result = response.choices[0]?.message?.content?.trim() || 'I apologize, I am unable to generate a response at the moment.';
      console.log(`[AI] Response: "${result}"`);
      return result;
    } catch (error) {
      console.error('AI Completion Error:', error);
      throw new Error('Failed to generate AI response');
    }
  }
}

export const aiProvider = new OpenRouterProvider();
