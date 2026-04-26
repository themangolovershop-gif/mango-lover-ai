# Implementation Plan: Webhook Hardening & Signal Extraction

## Phase 1: Webhook Hardening (Audit Fixes)
- [x] **Modify POST handler** in `src/app/api/webhook/route.ts` to return status `200` for all results that have been successfully logged, even if their status is `"failed"`.
- [x] **Wrap Side Effects**: Move non-critical updates (like `touchConversation` or `cancelPendingFollowUps`) into try/catch blocks that don't crash the main flow.
- [x] **Durable Logging**: Ensure `logWebhook` is called with the error details before returning to Meta.
- [x] **Latency Guard**: Added a 4000ms threshold to skip extraction if the response is taking too long.

## Phase 2: Background Entity Extraction
- [x] **Import `extractEntities`** from `@/backend/modules/ai/entity.service`.
- [x] **Implement `processBackgroundSignals`**: Extracts signals and updates lead tags/draft orders.
- [x] **Call in flow**: Invoked after sending the message, before the final 200 OK.

## Phase 3: Proactive Persona Hardening
- [x] **Update ActionExecutorService**: Integrated "Corporate Mango" storyteller voice into proactive nudges.
- [x] **Safety Re-check**: Re-run SalesSafetyLayer at send-time to prevent race conditions (implemented by user).

## Status: COMPLETE
The Lite flow is now production-hardened against Meta retry loops and latency spikes, while maintaining real-time dashboard signals.
