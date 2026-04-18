import type { ToolExecutionResult } from '@/backend/modules/tools/tool.types';

import type { AgentContext, AgentResult } from './types';

function getKnowledgeResult(
  context: AgentContext,
  names: ToolExecutionResult['name'][]
) {
  return context.groundingSnapshot?.toolResults.find((result) => names.includes(result.name));
}

export class MangoExpertAgent {
  async respond(context: AgentContext): Promise<AgentResult> {
    const mangoResult = getKnowledgeResult(context, ['search_mango_knowledge']);
    const businessResult = getKnowledgeResult(context, ['search_business_knowledge']);

    if (mangoResult?.replyHint) {
      return {
        agent: 'mango_expert',
        summary: 'Answered from the mango knowledge pack.',
        replyHint: mangoResult.replyHint,
        confidence: 0.98,
      };
    }

    if (businessResult?.replyHint) {
      return {
        agent: 'mango_expert',
        summary: 'Answered from business and trust knowledge.',
        replyHint: businessResult.replyHint,
        confidence: 0.9,
      };
    }

    return {
      agent: 'mango_expert',
      summary: 'Provided a safe mango expertise fallback.',
      replyHint: 'Our Devgad Alphonso is naturally ripened, carbide-free, and selected for aroma, sweetness, and a smoother texture. Tell me if you want guidance on quality, storage, gifting, or ripening.',
      confidence: 0.7,
    };
  }
}
