-- Run this manually in the Supabase SQL editor (this repo has no migrations
-- folder / DB tooling, so schema changes are applied by hand).
--
-- Backs the "Смешанная/Долг" payment button in pos.html: when a sale is paid
-- with the debt payment method, pos.js inserts one row here recording the
-- amount owed by that customer.

create table if not exists customer_debts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  store_location_id uuid references store_locations(id),
  client_id uuid not null references customers(id),
  sale_id uuid references sales(id),
  amount numeric not null,
  status text not null default 'open', -- open | paid | partial
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists customer_debts_company_id_idx on customer_debts(company_id);
create index if not exists customer_debts_client_id_idx on customer_debts(client_id);
create index if not exists customer_debts_status_idx on customer_debts(status);

alter table customer_debts enable row level security;

-- Mirrors the company-scoped RLS pattern already used by other tables
-- (e.g. supplier_debts) — adjust the auth lookup below if that pattern
-- differs from the one actually used elsewhere in this project.
create policy "customer_debts_company_scoped" on customer_debts
  for all
  using (
    company_id in (
      select company_id from company_users where user_id = auth.uid() and active = true
    )
  )
  with check (
    company_id in (
      select company_id from company_users where user_id = auth.uid() and active = true
    )
  );
