-- Run this in Supabase SQL Editor to set up the database

create table conversations (
  id uuid default gen_random_uuid() primary key,
  phone text unique not null,
  name text,
  mode text not null default 'agent' check (mode in ('agent', 'human')),
  sales_state text not null default 'new',
  lead_tag text,
  last_customer_intent text,
  follow_up_count integer not null default 0,
  last_follow_up_sent_at timestamp with time zone,
  updated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

create table messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  whatsapp_msg_id text unique,
  created_at timestamp with time zone default now()
);

create table orders (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  customer_name text,
  phone text not null,
  product_size text check (product_size in ('medium', 'large', 'jumbo')),
  quantity integer,
  delivery_address text,
  delivery_date text,
  order_type text not null default 'personal' check (order_type in ('personal', 'gift', 'corporate', 'subscription')),
  status text not null default 'draft' check (status in ('draft', 'awaiting_confirmation', 'confirmed', 'cancelled')),
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table follow_ups (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  phone text not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  scheduled_for timestamp with time zone not null,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index idx_messages_conversation on messages(conversation_id);
create index idx_messages_conversation_role_created on messages(conversation_id, role, created_at desc);
create index idx_conversations_updated on conversations(updated_at desc);
create index idx_orders_conversation on orders(conversation_id);
create index idx_follow_ups_conversation on follow_ups(conversation_id);
create index idx_follow_ups_status_scheduled on follow_ups(status, scheduled_for);
create index idx_follow_ups_pending_conversation on follow_ups(conversation_id, scheduled_for) where status = 'pending';

alter table conversations add column if not exists follow_up_count integer not null default 0;
alter table conversations add column if not exists last_follow_up_sent_at timestamp with time zone;

update conversations
set sales_state = 'browsing'
where sales_state = 'recommended';

update conversations
set sales_state = 'awaiting_address'
where sales_state = 'awaiting_location';

update conversations
set sales_state = 'awaiting_date'
where sales_state = 'awaiting_delivery_date';

alter table conversations drop constraint if exists conversations_sales_state_check;

alter table conversations
  add constraint conversations_sales_state_check
  check (
    sales_state in (
      'new',
      'browsing',
      'awaiting_quantity',
      'awaiting_name',
      'awaiting_address',
      'awaiting_date',
      'awaiting_confirmation',
      'confirmed',
      'human_handoff',
      'lost'
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'conversations_lead_tag_check'
  ) then
    alter table conversations
      add constraint conversations_lead_tag_check
      check (
        lead_tag is null
        or lead_tag in (
          'cold',
          'warm',
          'hot',
          'price_seeker',
          'gift_lead',
          'corporate_lead',
          'subscription_lead',
          'repeat_customer',
          'human_required'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'conversations_last_customer_intent_check'
  ) then
    alter table conversations
      add constraint conversations_last_customer_intent_check
      check (
        last_customer_intent is null
        or last_customer_intent in (
          'price',
          'delivery',
          'quality_trust',
          'gift',
          'corporate',
          'subscription',
          'visit_store',
          'ready_to_buy',
          'confused',
          'human_support'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_quantity_positive_check'
  ) then
    alter table orders
      add constraint orders_quantity_positive_check
      check (quantity is null or quantity > 0);
  end if;
end $$;

-- Enable Realtime for the dashboard
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table follow_ups;
