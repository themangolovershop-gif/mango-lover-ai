import { createClient } from '@supabase/supabase-js';
import { logger } from "@/backend/shared/lib/logger";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export class SessionResetService {
  /**
   * Performs a deep reset of a customer session.
   * Clears conversational state, draft orders, pending actions, and flags.
   */
  async deepReset(conversationId: string) {
    logger.info("session.reset.start", { conversationId });

    try {
      // 1. Reset Conversation fields
      const { error: convError } = await supabase
        .from('conversations')
        .update({
          sales_state: 'new',
          last_customer_intent: null,
          lead_tag: null
        })
        .eq('id', conversationId);

      if (convError) throw convError;

      // 2. Cancel Draft Orders
      const { error: orderError } = await supabase
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('conversation_id', conversationId)
        .eq('status', 'draft');

      if (orderError) logger.warn("session.reset.order_cancel_failed", { error: orderError.message });

      // 3. Cancel Pending Follow-ups
      const { error: fuError } = await supabase
        .from('follow_ups')
        .update({ status: 'cancelled' })
        .eq('conversation_id', conversationId)
        .eq('status', 'pending');

      if (fuError) logger.warn("session.reset.followup_cancel_failed", { error: fuError.message });

      logger.info("session.reset.complete", { conversationId });
    } catch (err) {
      logger.error("session.reset.failed", { 
        conversationId, 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
  }
}
