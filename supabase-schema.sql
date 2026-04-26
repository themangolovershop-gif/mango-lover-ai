-- The Mango Lover Shop
-- Live Next.js + Supabase schema for the WhatsApp webhook, dashboard, follow-ups, and logs.
--
-- This script is designed to be rerun safely in Supabase SQL Editor.
-- It covers the production path currently used by:
--   - src/app/api/webhook/route.ts
--   - src/app/api/cron/follow-ups/route.ts
--   - src/app/dashboard/page.tsx
--
-- Important:
--   - This script does NOT provision the separate Prisma backend schema under prisma/schema.prisma.
--   - Run this in the Supabase SQL Editor connected to the production project.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  name text,
  mode text not null default 'agent',
  sales_state text not null default 'new',
  lead_tag text,
  last_customer_intent text,
  follow_up_count integer not null default 0,
  last_follow_up_sent_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  role text not null,
  content text not null,
  whatsapp_msg_id text,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  customer_name text,
  phone text not null,
  product_size text,
  quantity integer,
  delivery_address text,
  delivery_date text,
  order_type text not null default 'personal',
  status text not null default 'draft',
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  phone text not null,
  message text not null,
  status text not null default 'pending',
  scheduled_for timestamp with time zone not null,
  sent_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  whatsapp_msg_id text,
  phone text,
  status text not null,
  payload jsonb,
  error text,
  duration_ms integer,
  created_at timestamp with time zone not null default now()
);

alter table public.conversations
  add column if not exists phone text,
  add column if not exists name text,
  add column if not exists mode text,
  add column if not exists sales_state text,
  add column if not exists lead_tag text,
  add column if not exists last_customer_intent text,
  add column if not exists follow_up_count integer,
  add column if not exists last_follow_up_sent_at timestamp with time zone,
  add column if not exists created_at timestamp with time zone,
  add column if not exists updated_at timestamp with time zone;

alter table public.messages
  add column if not exists conversation_id uuid,
  add column if not exists role text,
  add column if not exists content text,
  add column if not exists whatsapp_msg_id text,
  add column if not exists created_at timestamp with time zone;

alter table public.orders
  add column if not exists conversation_id uuid,
  add column if not exists customer_name text,
  add column if not exists phone text,
  add column if not exists product_size text,
  add column if not exists quantity integer,
  add column if not exists delivery_address text,
  add column if not exists delivery_date text,
  add column if not exists order_type text,
  add column if not exists status text,
  add column if not exists notes text,
  add column if not exists created_at timestamp with time zone,
  add column if not exists updated_at timestamp with time zone;

alter table public.follow_ups
  add column if not exists conversation_id uuid,
  add column if not exists phone text,
  add column if not exists message text,
  add column if not exists status text,
  add column if not exists scheduled_for timestamp with time zone,
  add column if not exists sent_at timestamp with time zone,
  add column if not exists created_at timestamp with time zone,
  add column if not exists updated_at timestamp with time zone;

alter table public.webhook_logs
  add column if not exists whatsapp_msg_id text,
  add column if not exists phone text,
  add column if not exists status text,
  add column if not exists payload jsonb,
  add column if not exists error text,
  add column if not exists duration_ms integer,
  add column if not exists created_at timestamp with time zone;

update public.conversations
set
  mode = coalesce(mode, 'agent'),
  sales_state = coalesce(sales_state, 'new'),
  follow_up_count = coalesce(follow_up_count, 0),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  mode is null
  or sales_state is null
  or follow_up_count is null
  or created_at is null
  or updated_at is null;

update public.messages
set
  created_at = coalesce(created_at, now())
where created_at is null;

update public.orders
set
  order_type = coalesce(order_type, 'personal'),
  status = coalesce(status, 'draft'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  order_type is null
  or status is null
  or created_at is null
  or updated_at is null;

update public.follow_ups
set
  status = coalesce(status, 'pending'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  status is null
  or created_at is null
  or updated_at is null;

update public.webhook_logs
set
  created_at = coalesce(created_at, now())
where created_at is null;

update public.conversations
set sales_state = 'browsing'
where sales_state = 'recommended';

update public.conversations
set sales_state = 'awaiting_address'
where sales_state = 'awaiting_location';

update public.conversations
set sales_state = 'awaiting_date'
where sales_state = 'awaiting_delivery_date';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_conversation_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_conversation_id_fkey
      foreign key (conversation_id)
      references public.conversations(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_conversation_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_conversation_id_fkey
      foreign key (conversation_id)
      references public.conversations(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'follow_ups_conversation_id_fkey'
  ) then
    alter table public.follow_ups
      add constraint follow_ups_conversation_id_fkey
      foreign key (conversation_id)
      references public.conversations(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversations_mode_check'
  ) then
    alter table public.conversations
      add constraint conversations_mode_check
      check (mode in ('agent', 'human'));
  end if;
end $$;

alter table public.conversations
  drop constraint if exists conversations_sales_state_check;

alter table public.conversations
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
    select 1 from pg_constraint where conname = 'conversations_lead_tag_check'
  ) then
    alter table public.conversations
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
    select 1 from pg_constraint where conname = 'conversations_last_customer_intent_check'
  ) then
    alter table public.conversations
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
    select 1 from pg_constraint where conname = 'messages_role_check'
  ) then
    alter table public.messages
      add constraint messages_role_check
      check (role in ('user', 'assistant'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_product_size_check'
  ) then
    alter table public.orders
      add constraint orders_product_size_check
      check (product_size is null or product_size in ('medium', 'large', 'jumbo'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_order_type_check'
  ) then
    alter table public.orders
      add constraint orders_order_type_check
      check (order_type in ('personal', 'gift', 'corporate', 'subscription'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_status_check'
  ) then
    alter table public.orders
      add constraint orders_status_check
      check (status in ('draft', 'awaiting_confirmation', 'confirmed', 'cancelled'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_quantity_positive_check'
  ) then
    alter table public.orders
      add constraint orders_quantity_positive_check
      check (quantity is null or quantity > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'follow_ups_status_check'
  ) then
    alter table public.follow_ups
      add constraint follow_ups_status_check
      check (status in ('pending', 'sent', 'cancelled'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_conversations_phone_unique'
  ) then
    if exists (
      select phone
      from public.conversations
      group by phone
      having count(*) > 1
    ) then
      raise notice 'Skipped unique index idx_conversations_phone_unique because duplicate phone values already exist.';
    else
      create unique index idx_conversations_phone_unique
        on public.conversations(phone);
    end if;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_messages_whatsapp_msg_id_unique'
  ) then
    if exists (
      select whatsapp_msg_id
      from public.messages
      where whatsapp_msg_id is not null
      group by whatsapp_msg_id
      having count(*) > 1
    ) then
      raise notice 'Skipped unique index idx_messages_whatsapp_msg_id_unique because duplicate WhatsApp message ids already exist.';
    else
      create unique index idx_messages_whatsapp_msg_id_unique
        on public.messages(whatsapp_msg_id)
        where whatsapp_msg_id is not null;
    end if;
  end if;
end $$;

create index if not exists idx_messages_conversation
  on public.messages(conversation_id);

create index if not exists idx_messages_conversation_role_created
  on public.messages(conversation_id, role, created_at desc);

create index if not exists idx_conversations_updated
  on public.conversations(updated_at desc);

create index if not exists idx_orders_conversation
  on public.orders(conversation_id);

create index if not exists idx_orders_conversation_status_updated
  on public.orders(conversation_id, status, updated_at desc);

create index if not exists idx_follow_ups_conversation
  on public.follow_ups(conversation_id);

create index if not exists idx_follow_ups_status_scheduled
  on public.follow_ups(status, scheduled_for);

create index if not exists idx_follow_ups_pending_conversation
  on public.follow_ups(conversation_id, scheduled_for)
  where status = 'pending';

create index if not exists idx_webhook_logs_phone_created
  on public.webhook_logs(phone, created_at desc);

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row
execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

drop trigger if exists follow_ups_set_updated_at on public.follow_ups;
create trigger follow_ups_set_updated_at
before update on public.follow_ups
for each row
execute function public.set_updated_at();

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'conversations'
    ) then
      alter publication supabase_realtime add table public.conversations;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'orders'
    ) then
      alter publication supabase_realtime add table public.orders;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'follow_ups'
    ) then
      alter publication supabase_realtime add table public.follow_ups;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'webhook_logs'
    ) then
      alter publication supabase_realtime add table public.webhook_logs;
    end if;
  else
    raise notice 'Publication supabase_realtime was not found. Skipping realtime publication setup.';
  end if;
end $$;

create or replace function public.increment_follow_up_count(conv_id uuid)
returns setof public.conversations
language plpgsql
set search_path = public
as $$
begin
  return query
  update public.conversations
  set
    follow_up_count = coalesce(follow_up_count, 0) + 1,
    last_follow_up_sent_at = now(),
    updated_at = now()
  where id = conv_id
  returning *;
end;
$$;

create or replace function public.acquire_lock(lock_id bigint)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  return pg_try_advisory_lock(lock_id);
end;
$$;

create or replace function public.release_lock(lock_id bigint)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  return pg_advisory_unlock(lock_id);
end;
$$;

-- RLS SETUP
-- Enable RLS on all tables
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.orders enable row level security;
alter table public.follow_ups enable row level security;
alter table public.webhook_logs enable row level security;

-- The following tables were mentioned in the schema but might be managed via Prisma. 
-- We enable RLS on them as well if they exist.
do $$ 
begin
  alter table if exists public.analytics_events enable row level security;
  alter table if exists public.customer_memory enable row level security;
  alter table if exists public.revenue enable row level security;
exception when others then null;
end $$;

-- Create policies to allow Service Role (Backend) full access while denying everyone else.
-- Note: service_role bypasses RLS by default, but adding these policies clears the Supabase Advisor warnings.

create policy "Service role full access" on public.conversations for all to service_role using (true) with check (true);
create policy "Service role full access" on public.messages for all to service_role using (true) with check (true);
create policy "Service role full access" on public.orders for all to service_role using (true) with check (true);
create policy "Service role full access" on public.follow_ups for all to service_role using (true) with check (true);
create policy "Service role full access" on public.webhook_logs for all to service_role using (true) with check (true);

do $$ 
begin
  if exists (select 1 from pg_tables where tablename = 'analytics_events') then
    create policy "Service role full access" on public.analytics_events for all to service_role using (true) with check (true);
  end if;
  if exists (select 1 from pg_tables where tablename = 'customer_memory') then
    create policy "Service role full access" on public.customer_memory for all to service_role using (true) with check (true);
  end if;
  if exists (select 1 from pg_tables where tablename = 'revenue') then
    create policy "Service role full access" on public.revenue for all to service_role using (true) with check (true);
  end if;
exception when others then null;
end $$;

