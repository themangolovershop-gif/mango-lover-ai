import { normalizeMessage } from '@/backend/shared/utils/normalization';

import type { ToolExecutionContext, ToolInvocation, ToolPlan } from './tool.types';

function pushTool(
  tools: ToolInvocation[],
  tool: ToolInvocation
) {
  const key = `${tool.name}:${JSON.stringify(tool.args ?? {})}`;

  if (tools.some((existing) => `${existing.name}:${JSON.stringify(existing.args ?? {})}` === key)) {
    return;
  }

  tools.push(tool);
}

function includesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function isPaymentStatusQuery(text: string) {
  return text.includes('payment') && text.includes('status');
}

function isNaturalRipeningQuery(text: string) {
  return includesAny(text, ['natural', 'ripening', 'carbide', 'sweet', 'store', 'storage', 'ripen']);
}

function isMangoComparisonQuery(text: string) {
  return text.includes('ratnagiri') || (text.includes('difference') && text.includes('devgad'));
}

function isPremiumBusinessQuery(text: string) {
  return includesAny(text, ['premium', 'why premium', 'website', 'legacy', 'family', 'policy']);
}

function isBusinessInfoQuery(text: string) {
  return (
    includesAny(text, ['location', 'shop', 'visit', 'pickup', 'website']) ||
    (text.includes('where') && includesAny(text, ['shop', 'visit', 'located', 'location'])) ||
    (text.includes('address') && !text.includes('change address') && !text.includes('wrong address'))
  );
}

function isLogisticsPolicyQuery(text: string) {
  return (
    text.includes('courier') ||
    text.includes('charge') ||
    (text.includes('delivery') && includesAny(text, ['time', 'hours', 'days', 'metro', 'mumbai', 'how long']))
  );
}

function wantsReorder(text: string) {
  return includesAny(text, [
    'same as previous',
    'same as last time',
    'same again',
    'book same',
    'last time',
    'previous order',
  ]);
}

function wantsAddressUpdate(text: string) {
  return text.includes('address') || text.includes('pincode') || text.includes('pin code');
}

export class ToolRouterService {
  decideToolPlan(context: ToolExecutionContext): ToolPlan {
    const tools: ToolInvocation[] = [];
    const reasons: string[] = [];
    const latestMessage = normalizeMessage(context.latestUserMessage);

    if (context.intents.includes('order_summary_request')) {
      pushTool(tools, {
        name: 'get_current_order_summary',
        reason: 'Customer asked for the current order summary.',
      });
      reasons.push('Use live order data for the summary request.');
    }

    if (isPaymentStatusQuery(latestMessage)) {
      pushTool(tools, {
        name: 'get_payment_status',
        reason: 'Customer asked for payment status.',
      });
      reasons.push('Use live payment state instead of guessing.');
    }

    if (context.intents.includes('edit_order_request') && context.entities.quantityDozen) {
      pushTool(tools, {
        name: 'update_order_quantity',
        args: {
          quantityDozen: context.entities.quantityDozen,
        },
        reason: 'Customer asked to change the order quantity.',
      });
      reasons.push('Apply the quantity change using the current draft order.');
    }

    if (context.intents.includes('edit_order_request') && context.entities.size) {
      pushTool(tools, {
        name: 'update_order_size',
        args: {
          size: context.entities.size,
        },
        reason: 'Customer asked to change the order size.',
      });
      reasons.push('Apply the size change using the current draft order.');
    }

    if (context.intents.includes('edit_order_request') && wantsAddressUpdate(latestMessage)) {
      pushTool(tools, {
        name: 'update_order_address',
        args: {
          addressText: context.entities.addressText ?? context.latestUserMessage,
          city: context.entities.city,
          pinCode: context.entities.pinCode,
        },
        reason: 'Customer asked to change the delivery address.',
      });
      reasons.push('Update address data through the operational address path.');
    }

    if (context.intents.includes('restart_order_request') || context.intents.includes('cancellation')) {
      pushTool(tools, {
        name: 'restart_order_session',
        reason: 'Customer asked to restart or cancel the current order flow.',
      });
      reasons.push('Reset the live draft state before replying.');
    }

    if (context.intents.includes('pricing')) {
      if (context.entities.size && context.entities.quantityDozen) {
        pushTool(tools, {
          name: 'get_quote',
          args: {
            size: context.entities.size,
            quantityDozen: context.entities.quantityDozen,
            city: context.entities.city,
          },
          reason: 'Customer asked for a live quote.',
        });
        reasons.push('Use live product pricing and delivery rules for the quote.');
      } else if (context.entities.size) {
        pushTool(tools, {
          name: 'get_product_by_size',
          args: {
            size: context.entities.size,
          },
          reason: 'Customer asked about size pricing or selection.',
        });
        reasons.push('Use the active product record for the requested size.');
      } else {
        pushTool(tools, {
          name: 'get_catalog_overview',
          reason: 'Customer asked for generic pricing without a specific size.',
        });
        reasons.push('Use the live active catalog for the current base prices.');
      }
    }

    if (
      (context.intents.includes('order_start') || context.intents.includes('product_selection')) &&
      context.entities.size &&
      context.entities.quantityDozen
    ) {
      pushTool(tools, {
        name: 'get_quote',
        args: {
          size: context.entities.size,
          quantityDozen: context.entities.quantityDozen,
          city: context.entities.city,
        },
        reason: 'Customer already shared size and quantity while starting the order.',
      });
      reasons.push('Acknowledge the concrete order details with live pricing.');
    }

    if (context.intents.includes('delivery_check') && context.entities.city) {
      pushTool(tools, {
        name: 'get_delivery_charge',
        args: {
          city: context.entities.city,
          size: context.entities.size,
        },
        reason: 'Customer asked about delivery handling for a city.',
      });
      reasons.push('Use configured city and delivery rules.');
    }

    if (context.intents.includes('repeat_order') && wantsReorder(latestMessage)) {
      pushTool(tools, {
        name: 'get_last_successful_order',
        reason: 'Customer referred to the previous order.',
      });
      pushTool(tools, {
        name: 'reorder_last_order',
        reason: 'Customer wants the previous order booked again.',
      });
      reasons.push('Use order history to support fast repeat ordering.');
    } else if (context.intents.includes('repeat_order')) {
      pushTool(tools, {
        name: 'get_last_successful_order',
        reason: 'Customer referred to a past order.',
      });
      reasons.push('Use order history rather than prompt memory.');
    }

    if (context.intents.includes('recommendation_request') || context.intents.includes('gifting')) {
      pushTool(tools, {
        name: 'get_customer_memory',
        reason: 'Recommendations should consider repeat-buyer memory.',
      });
      pushTool(tools, {
        name: 'search_mango_knowledge',
        args: {
          query: context.intents.includes('gifting') ? 'best for gifting' : context.latestUserMessage,
        },
        reason: 'Customer asked for a recommendation that depends on mango knowledge.',
      });
      reasons.push('Combine memory and mango knowledge for recommendations.');
    }

    if (
      context.intents.includes('quality_check') ||
      context.intents.includes('authenticity_check') ||
      isNaturalRipeningQuery(latestMessage) ||
      isMangoComparisonQuery(latestMessage)
    ) {
      pushTool(tools, {
        name: 'search_mango_knowledge',
        args: {
          query: context.latestUserMessage,
        },
        reason: 'Customer asked a mango knowledge question.',
      });
      reasons.push('Use structured mango knowledge instead of free-form guessing.');
    }

    if (
      isBusinessInfoQuery(latestMessage) ||
      isLogisticsPolicyQuery(latestMessage) ||
      context.intents.includes('delivery_check') ||
      isPremiumBusinessQuery(latestMessage) ||
      context.intents.includes('objection_price')
    ) {
      pushTool(tools, {
        name: 'search_business_knowledge',
        args: {
          query: context.latestUserMessage,
        },
        reason: 'Customer asked about brand, premium positioning, or policy.',
      });
      reasons.push('Ground premium/business claims in business knowledge.');
    }

    if (context.intents.includes('human_help_request')) {
      pushTool(tools, {
        name: 'escalate_to_human',
        args: {
          type: 'LOW_CONFIDENCE',
          reason: 'Customer asked for human support.',
        },
        reason: 'Customer explicitly asked for human support.',
      });
      reasons.push('Use escalation tools when the customer explicitly wants human help.');
    }

    return {
      tools,
      reasons,
      requiresLiveData: tools.some((tool) =>
        !tool.name.startsWith('search_')
      ),
    };
  }
}

export const toolRouterService = new ToolRouterService();
