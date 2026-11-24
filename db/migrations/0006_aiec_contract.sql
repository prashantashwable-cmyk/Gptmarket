-- AIEC Contract execution model (brief sections 10, 12, 14).
-- The customer contracts with AIEC; AIEC invoices the customer, receives payments and pays the
-- engaged licensed partner by milestone. Marketplace orders are unchanged (partner collects,
-- AIEC earns milestone commission). Contracts, invoices, payments and liability stay separate.

-- ───────────── orders: one table, two execution models ─────────────
alter table orders
  add column execution_model text not null default 'MARKETPLACE' check (execution_model in ('AIEC_CONTRACT','MARKETPLACE')),
  add column market_quotation_id uuid references market_quotations(id),
  add column market_quotation_version_id uuid references market_quotation_versions(id),
  add column partner_payout_value numeric(14,2) check (partner_payout_value is null or partner_payout_value > 0),
  add column partner_scope_note text;
alter table orders alter column quotation_id drop not null;
alter table orders alter column quotation_version_id drop not null;
alter table orders add constraint orders_model_source_chk check (
  (execution_model = 'MARKETPLACE' and quotation_id is not null and quotation_version_id is not null and market_quotation_version_id is null)
  or (execution_model = 'AIEC_CONTRACT' and market_quotation_id is not null and market_quotation_version_id is not null
      and quotation_id is null and partner_payout_value is not null and eligible_value is null));
create index orders_market_quotation_idx on orders(market_quotation_id);

-- ───────────── AIEC invoices to the customer (one per project milestone) ─────────────
create sequence customer_invoice_no_seq;
create table customer_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique default app.next_no('AI', 'customer_invoice_no_seq'),
  order_id uuid not null references orders(id),
  project_id uuid not null references projects(id),
  milestone_id uuid not null unique references project_milestones(id),
  customer_id uuid not null references customers(id),
  taxable_amount numeric(14,2) not null check (taxable_amount >= 0),
  gst_percent numeric(7,4) not null check (gst_percent >= 0),
  gst_amount numeric(14,2) not null check (gst_amount >= 0),
  total_amount numeric(14,2) not null check (total_amount > 0),
  issue_date date not null,
  due_date date not null check (due_date >= issue_date),
  status text not null default 'ISSUED' check (status in ('ISSUED','PARTLY_PAID','PAID','CANCELLED')),
  cancel_reason text,
  issued_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (total_amount = taxable_amount + gst_amount)
);
create index customer_invoices_order_idx on customer_invoices(order_id);
create or replace function app.guard_customer_invoice() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'APPEND_ONLY: invoices are cancelled, never deleted' using errcode = 'P0001'; end if;
  if (to_jsonb(new) - 'status' - 'cancel_reason') <> (to_jsonb(old) - 'status' - 'cancel_reason') then
    raise exception 'APPEND_ONLY: invoice amounts never change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger customer_invoices_guard before update or delete on customer_invoices for each row execute function app.guard_customer_invoice();

-- ───────────── customer payments to AIEC ─────────────
-- A payment is VERIFIED only by AIEC finance (bank reference checked) or by a signed gateway
-- webhook. A browser "success" never verifies a payment.
create table customer_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references customer_invoices(id),
  order_id uuid not null references orders(id),
  customer_id uuid not null references customers(id),
  amount numeric(14,2) not null check (amount > 0),
  refunded_amount numeric(14,2) not null default 0 check (refunded_amount >= 0),
  payment_mode text not null check (payment_mode in ('BANK_TRANSFER','UPI','CHEQUE','DEMAND_DRAFT','CARD','NET_BANKING','LOAN_DISBURSEMENT','GATEWAY')),
  reference text not null check (length(reference) between 3 and 120),
  paid_on date not null,
  status text not null default 'PENDING_VERIFICATION' check (status in ('PENDING_VERIFICATION','VERIFIED','REJECTED')),
  verification_basis text check (verification_basis is null or verification_basis in ('BANK_STATEMENT','GATEWAY_WEBHOOK')),
  gateway text check (gateway is null or gateway = 'RAZORPAY'),
  gateway_payment_id text unique,
  recorded_by uuid references users(id),
  verified_by uuid references users(id),
  verified_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (refunded_amount <= amount),
  check (status <> 'VERIFIED' or verification_basis is not null)
);
create unique index customer_payments_ref_uq on customer_payments(payment_mode, reference) where status <> 'REJECTED';
create index customer_payments_invoice_idx on customer_payments(invoice_id);

create table customer_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references customer_payments(id),
  order_id uuid not null references orders(id),
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(reason) between 3 and 1000),
  reference text,
  recorded_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create trigger customer_refunds_immutable before update or delete on customer_refunds for each row execute function app.forbid_change();

-- ───────────── partner payouts (AIEC → engaged licensed partner) ─────────────
create table partner_payouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  project_id uuid not null references projects(id),
  milestone_id uuid not null unique references project_milestones(id),
  company_id uuid not null references companies(id),
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','PAID','HELD')),
  approved_by uuid references users(id),
  approved_at timestamptz,
  hold_reason text,
  paid_reference text,
  paid_on date,
  paid_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (status <> 'PAID' or (paid_reference is not null and paid_on is not null))
);
create index partner_payouts_company_idx on partner_payouts(company_id);

grant select, insert, update, delete on all tables in schema public to aiec_app;
grant usage, select on all sequences in schema public to aiec_app;

do $$
declare
  i text := 'app.is_internal()';
  cnt text := '(company_id = app.company_id() and not app.is_technician())';
  u text := 'customer_id = app.customer_id()';
begin
  -- Only AIEC staff write money records. Customers read their own invoices and payments; the
  -- engaged partner reads its own payouts. Partners do not see AIEC's invoices or customer payments.
  perform app.protect('customer_invoices', i, u);
  perform app.protect('customer_payments', i, u);
  perform app.protect('customer_refunds', i, 'exists (select 1 from customer_payments p where p.id = customer_refunds.payment_id and p.customer_id = app.customer_id())');
  perform app.protect('partner_payouts', i, cnt);
end $$;

-- Scope summary of an AIEC Contract order for everyone who may see the order (staff, the engaged
-- partner, the customer). Partners cannot read package quotations (they contain the customer's
-- price build-up), so this exposes only the quotation number, package and milestone percentages.
create or replace function app.aiec_order_scope(p_order uuid)
returns table (quotation_number text, version_no int, package_title text, milestones jsonb)
language sql stable security definer set search_path = public as $$
  select q.quotation_number, v.version_no, v.snapshot->'package'->>'title', v.snapshot->'paymentMilestones'
    from orders o join market_quotations q on q.id = o.market_quotation_id join market_quotation_versions v on v.id = o.market_quotation_version_id
   where o.id = p_order and o.execution_model = 'AIEC_CONTRACT'
     and (app.is_internal() or (o.company_id = app.company_id() and not app.is_technician()) or o.customer_id = app.customer_id())
$$;
grant execute on function app.aiec_order_scope(uuid) to aiec_app;
