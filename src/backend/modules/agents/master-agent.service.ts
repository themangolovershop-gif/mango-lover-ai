import { logger } from '@/backend/shared/lib/logger';
import { SessionResetService } from '../session/reset.service';
import { ResponseComposer } from './composer.service';
import { MangoExpertAgent } from './mango-expert.service';
import { OrchestratorAgent } from './orchestrator.service';
import { OrderOpsAgent } from './order-ops.service';
import { RecoveryAgent } from './recovery.service';
import { SalesAgent } from './sales.service';
import type { AgentContext, AgentProcessResult, AgentResult, AgentType } from './types';

export class MasterAgent {
  private orchestrator = new OrchestratorAgent();
  private sales = new SalesAgent();
  private expert = new MangoExpertAgent();
  private ops = new OrderOpsAgent();
  private recovery = new RecoveryAgent();
  private composer = new ResponseComposer();
  private resetSvc = new SessionResetService();

  async process(context: AgentContext): Promise<AgentProcessResult> {
    // 1. Check for Reset Intent First
    if (context.intents.includes('restart_order_request') || context.intents.includes('reset_conversation')) {
      logger.info('agents.master.reset_detected', { conversationId: context.conversationId });
      await this.resetSvc.deepReset(context.conversationId);
    }

    // 2. Decide Agents
    const decision = await this.orchestrator.decide(context);
    
    // Priority Rule: If an interrupt is detected, we focus on the primary agent response 
    // and potentially suppress background sales nudges to avoid being "pushy"
    const agentsToRun: AgentType[] = [decision.primaryAgent, ...decision.secondaryAgents];
    const results: AgentResult[] = [];

    logger.info('agents.master.executing', {
      conversationId: context.conversationId,
      primary: decision.primaryAgent,
      secondary: decision.secondaryAgents,
      reason: decision.reason,
      interrupt: decision.interruptDetected
    });

    for (const agentType of agentsToRun) {
      let result: AgentResult | null = null;

      try {
        switch (agentType) {
          case 'recovery':
            result = await this.recovery.respond(context);
            break;
          case 'order_ops':
            result = await this.ops.respond(context);
            break;
          case 'mango_expert':
            result = await this.expert.respond(context);
            break;
          case 'sales':
            // If we have an interrupt and primary was not sales, 
            // the sales agent should only provide a "transition" draft or be silent
            result = await this.sales.respond(context);
            break;
          default:
            break;
        }

        if (result) {
          results.push(result);
        }
      } catch (error) {
        logger.error(`agents.master.agent_failed.${agentType}`, {
          conversationId: context.conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 3. Compose Final Response
    const responseText = this.composer.compose(context, results);

    return {
      responseText,
      results,
      decision,
    };
  }
}

export const masterAgent = new MasterAgent();
