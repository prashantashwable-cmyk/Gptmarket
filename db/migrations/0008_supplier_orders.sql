-- Supplier purchase orders for AIEC Contract projects (brief section 8: orders, dispatch updates,
-- supplier ledger). Lines and amounts come from the cost build-up frozen in the accepted quotation,
-- so later supplier price changes never alter a purchase order.
create sequence supplier_po_no_seq;
create table supplier_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique default app.next_no('PO', 'supplier_po_no_seq'),
  order_id uuid not null references orders(id),
  company_id uuid not null references companies(id), -- the supplier
  status text not null default 'ISSUED' check (status in ('ISSUED','ACKNOWLEDGED','DISPATCHED','DELIVERED','CANCELLED')),
  total_cost numeric(14,2) not null check (total_cost >= 0),
  -- What the supplier needs to deliver, copied at issue (suppliers cannot read orders or leads).
  order_number text not null,
  project_label text not null,
  delivery_address text not null,
  expected_delivery date,
  dispatch_reference text,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  received_by uuid references users(id),
  cancel_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (order_id, company_id),
  check (status <> 'DISPATCHED' or dispatch_reference is not null)
);
create index supplier_po_company_idx on supplier_purchase_orders(company_id);

create table supplier_po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references supplier_purchase_orders(id),
  product_id uuid not null references supplier_products(id),
  description text not null,
  quantity int not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);
create trigger supplier_po_lines_immutable before update or delete on supplier_po_lines for each row execute function app.forbid_change();

create or replace function app.guard_supplier_po() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'APPEND_ONLY: purchase orders are cancelled, never deleted' using errcode = 'P0001'; end if;
  if new.total_cost is distinct from old.total_cost or new.order_id is distinct from old.order_id or new.company_id is distinct from old.company_id then
    raise exception 'APPEND_ONLY: purchase order amounts never change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger supplier_po_guard before update or delete on supplier_purchase_orders for each row execute function app.guard_supplier_po();

create table supplier_payments (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references supplier_purchase_orders(id),
  company_id uuid not null references companies(id),
  amount numeric(14,2) not null check (amount > 0),
  reference text not null check (length(reference) between 3 and 120),
  paid_on date not null,
  recorded_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create trigger supplier_payments_immutable before update or delete on supplier_payments for each row execute function app.forbid_change();

grant select, insert, update, delete on all tables in schema public to aiec_app;
grant usage, select on all sequences in schema public to aiec_app;

do $$
declare
  i text := 'app.is_internal()';
  cnt text := '(company_id = app.company_id() and not app.is_technician())';
begin
  -- AIEC staff create and manage; the supplier reads its own and may update status (acknowledge / dispatch)
  -- through the service. Amounts are protected by the triggers above.
  perform app.protect('supplier_purchase_orders', i || ' or ' || cnt);
  perform app.protect('supplier_po_lines', i, 'exists (select 1 from supplier_purchase_orders po where po.id = supplier_po_lines.po_id)');
  perform app.protect('supplier_payments', i, cnt);
end $$;

-- Idempotent event recording for every role. Row-level security requires read access for
-- INSERT ... ON CONFLICT, and only AIEC staff may read the event log, so the insert runs here as
-- a narrow trusted function that returns true when the idempotency key was new.
create or replace function app.emit_event(p_type text, p_key text, p_entity_type text, p_entity_id uuid, p_actor uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into automation_events (event_type, idempotency_key, entity_type, entity_id, actor_id, payload, status, attempts, processed_at)
  values (p_type, p_key, p_entity_type, p_entity_id, p_actor, p_payload, 'DONE', 1, now())
  on conflict (idempotency_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count = 1;
end $$;
grant execute on function app.emit_event(text, text, text, uuid, uuid, jsonb) to aiec_app;
