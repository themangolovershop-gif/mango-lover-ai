# Mango Sales Platform Plan

## Phase 1: Architecture

### Current extension strategy

The repo already has a working webhook, deterministic checkout flow, Supabase persistence, and a simple operator console. The safest production path is to keep that operational core intact and add a modular intelligence layer around it rather than replacing the architecture in one move.

### Target module map

- `whatsapp-webhook-service`: validates signatures, receives inbound provider payloads, stores raw messages.
- `message-ingestion-service`: normalizes text, detects language style, deduplicates provider events.
- `intent-classification-service`: multi-intent detection for sales, support, logistics, payment, and escalation.
- `entity-extraction-service`: product, quantity, address, city, payment, gifting, corporate, urgency, and complaint extraction.
- `conversation-state-service`: deterministic order capture plus lead-stage updates.
- `reply-generation-service`: deterministic replies first, LLM fallback second, brand-safety formatting last.
- `crm-service`: lead profile, score, buyer type, temperature, notes, and repeat-buyer signals.
- `order-service`: draft orders, item selection, lifecycle states, payment and fulfillment linkage.
- `payment-service`: manual UPI verification now, gateway abstraction later.
- `followup-service`: rules-based recovery, pending-payment reminders, opt-out aware scheduling.
- `human-escalation-service`: complaint, refund, bulk, corporate, low-confidence, and VIP routing.
- `admin-dashboard`: owner console for inbox, leads, orders, follow-ups, escalations, analytics, and settings.
- `audit-log-service`: outbound sends, operator actions, payment verification, and workflow changes.
- `analytics-service`: conversion funnel, objections, repeat buyers, revenue, follow-up performance.

### Folder structure

```text
src/
  app/
    api/
      webhook/
      cron/follow-ups/
      conversations/
      orders/
      analytics/
      settings/
    dashboard/
  lib/
    ai.ts
    followups.ts
    sales.ts
    sales-intelligence.ts
    sales-platform-contracts.ts
    sales-settings.ts
    prompt-templates.ts
    whatsapp.ts
  components/
    dashboard/
docs/
  mango-sales-platform-phases.md
```

### Event flow

1. Inbound WhatsApp webhook arrives.
2. Signature is verified and the raw message is persisted.
3. The ingestion layer normalizes messy text and derives a structured analysis snapshot.
4. Deterministic checkout logic runs first to protect order capture and state transitions.
5. Lead scoring, temperature, escalation recommendation, and follow-up decisions are computed.
6. Deterministic reply templates are used where the flow is sensitive.
7. LLM fallback is used only for natural conversation outside locked checkout steps.
8. Outbound WhatsApp reply is sent and persisted.
9. Follow-ups and audit logs are updated.

### State machines

`sales_state`

- `new`
- `browsing`
- `awaiting_quantity`
- `awaiting_name`
- `awaiting_address`
- `awaiting_date`
- `awaiting_confirmation`
- `confirmed`
- `human_handoff`
- `lost`

`lead_stage`

- `new_inquiry`
- `engaged`
- `qualified`
- `product_recommended`
- `objection_price`
- `objection_quality`
- `awaiting_details`
- `awaiting_payment`
- `payment_submitted`
- `order_confirmed`
- `dispatched`
- `delivered`
- `repeat_customer`
- `complaint_open`
- `escalated`
- `cold`
- `lost`

`future order lifecycle`

- `draft`
- `pending_details`
- `pending_payment`
- `payment_under_review`
- `confirmed`
- `packed`
- `dispatched`
- `delivered`
- `cancelled`
- `refund_requested`
- `refunded`
- `on_hold`

## Phase 2: Backend Scaffold

### Implemented in code now

- Shared brand and product configuration in `src/lib/sales-settings.ts`.
- Platform contracts and future service interfaces in `src/lib/sales-platform-contracts.ts`.
- Message normalization, multi-intent detection, entity extraction, scoring, and escalation logic in `src/lib/sales-intelligence.ts`.
- Prompt template scaffolding in `src/lib/prompt-templates.ts`.

### Next backend step

- Move provider writes behind a `WhatsAppProviderAdapter`.
- Add persistence for structured message analysis once the database migration is deployed.
- Split lead, order, payment, and escalation operations into isolated services with DTO validators.

## Phase 3: Admin Dashboard

### Current live surface

- Conversation inbox
- Manual send
- Human handoff
- Follow-up scheduling
- Basic webhook logs

### Recommended next screens

- Overview dashboard with funnel metrics and revenue.
- Leads list with lead stage, score, buyer type, and escalation flags.
- Orders and payments view with manual verification workflow.
- Escalation queue for complaints, corporate, bulk, and low-confidence cases.
- Settings and prompt manager for pricing, batch notes, thresholds, and tone controls.

## Phase 4: Prompting, Scenarios, and CRM Logic

### Prompt architecture

- System prompt: permanent brand and safety instructions.
- Prompt templates: welcome, pricing, recommendation, objection, payment, confirmation, complaint, escalation.
- Runtime context: customer summary, conversation summary, live catalog, lead stage, extracted entities, disallowed claims.

### Scenario strategy

- Deterministic handling for checkout, payment, status, escalation, and complaint intake.
- Heuristic plus LLM blend for objection handling, recommendation language, typo-heavy understanding, and repeat-buyer conversations.
- Normalization for Hinglish, shorthand, and spelling mistakes before any high-level reasoning.

## Phase 5: Production Hardening

### Environment and deployment

- Keep webhook auth strict in production.
- Separate preview vs production secrets and WhatsApp endpoints.
- Add structured logging around provider sends, retries, and manual overrides.
- Add schema migrations for lead, payment, escalation, analytics, and settings tables before enabling richer persistence.

### Verification

- Focused unit tests for normalization, state transitions, follow-up cancellation, and escalation rules.
- End-to-end webhook simulation with mocked provider sends.
- Required build verification:
  - `npm run build`
  - `npx tsc --noEmit`

## Future data model

The prompt asked for a broader CRM schema than the currently deployed tables. The implemented code now prepares for that expansion, and the next migration should add:

- `customers`
- `leads`
- `products`
- `availability_batches`
- `order_items`
- `payments`
- `escalations`
- `admins`
- `audit_logs`
- structured columns on `messages` for normalized text, detected intent, confidence, and extracted entities
