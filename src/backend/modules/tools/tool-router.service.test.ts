import { PaymentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import type { ExtractedEntities } from '@/backend/modules/ai/entity.service';
import type { IntentType } from '@/backend/modules/ai/intent.service';
import { toolRouterService } from '@/backend/modules/tools/tool-router.service';
import type { ToolExecutionContext } from '@/backend/modules/tools/tool.types';

function buildContext(args: {
  latestUserMessage: string;
  intents: IntentType[];
  entities?: ExtractedEntities;
}): ToolExecutionContext {
  return {
    customerId: 'customer-1',
    conversationId: 'conversation-1',
    leadId: 'lead-1',
    phone: '+919999999999',
    leadStage: 'ENGAGED',
    buyerType: 'PERSONAL',
    nextAction: 'EDUCATE',
    intents: args.intents,
    entities: args.entities ?? {},
    latestUserMessage: args.latestUserMessage,
    latestOrder: null,
    paymentStatus: PaymentStatus.UNPAID,
    memorySnapshot: null,
  };
}

describe('tool-router.service', () => {
  it('routes order summary requests to live order tools', () => {
    const plan = toolRouterService.decideToolPlan(
      buildContext({
        latestUserMessage: 'what did i order',
        intents: ['order_summary_request'],
      })
    );

    expect(plan.tools.map((tool) => tool.name)).toContain('get_current_order_summary');
  });

  it('routes quantity edits to update tools', () => {
    const plan = toolRouterService.decideToolPlan(
      buildContext({
        latestUserMessage: 'change quantity to 3 dozen',
        intents: ['edit_order_request'],
        entities: {
          quantityDozen: 3,
        },
      })
    );

    expect(plan.tools.map((tool) => tool.name)).toContain('update_order_quantity');
  });

  it('routes restart requests to restart_order_session', () => {
    const plan = toolRouterService.decideToolPlan(
      buildContext({
        latestUserMessage: 'start again',
        intents: ['restart_order_request'],
      })
    );

    expect(plan.tools.map((tool) => tool.name)).toContain('restart_order_session');
  });

  it('routes natural ripening questions to mango knowledge', () => {
    const plan = toolRouterService.decideToolPlan(
      buildContext({
        latestUserMessage: 'natural hai?',
        intents: ['quality_check'],
      })
    );

    expect(plan.tools.map((tool) => tool.name)).toContain('search_mango_knowledge');
  });

  it('routes gifting recommendations through memory and mango knowledge', () => {
    const plan = toolRouterService.decideToolPlan(
      buildContext({
        latestUserMessage: 'which is best for gift',
        intents: ['recommendation_request', 'gifting'],
      })
    );

    expect(plan.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['get_customer_memory', 'search_mango_knowledge'])
    );
  });

  it('routes quotes to the live quote tool', () => {
    const plan = toolRouterService.decideToolPlan(
      buildContext({
        latestUserMessage: '2 dozen large mumbai kitna',
        intents: ['pricing'],
        entities: {
          quantityDozen: 2,
          size: 'large',
          city: 'mumbai',
        },
      })
    );

    expect(plan.tools.map((tool) => tool.name)).toContain('get_quote');
  });

  it('routes generic pricing questions to the catalog overview tool', () => {
    const plan = toolRouterService.decideToolPlan(
      buildContext({
        latestUserMessage: 'price?',
        intents: ['pricing'],
      })
    );

    expect(plan.tools.map((tool) => tool.name)).toContain('get_catalog_overview');
  });

  it('routes shop location questions to business knowledge', () => {
    const plan = toolRouterService.decideToolPlan(
      buildContext({
        latestUserMessage: 'shop location?',
        intents: ['unknown'],
      })
    );

    expect(plan.tools.map((tool) => tool.name)).toContain('search_business_knowledge');
  });

  it('routes size and quantity order-start questions to a live quote', () => {
    const plan = toolRouterService.decideToolPlan(
      buildContext({
        latestUserMessage: '2 dozen large chahiye',
        intents: ['order_start'],
        entities: {
          quantityDozen: 2,
          size: 'large',
        },
      })
    );

    expect(plan.tools.map((tool) => tool.name)).toContain('get_quote');
  });

  it('routes reorder requests through history and draft creation', () => {
    const plan = toolRouterService.decideToolPlan(
      buildContext({
        latestUserMessage: 'book same as previous order',
        intents: ['repeat_order'],
      })
    );

    expect(plan.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['get_last_successful_order', 'reorder_last_order'])
    );
  });
});
