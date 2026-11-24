-- AIEC Lift Marketplace: ready-made packages, approved supplier catalogue, versioned pricing and
-- compatibility rules, customer configurations (cart) and immutable package quotations.
-- Additive only: no existing column is changed except the file kind list and two nullable columns.
-- No prices are inserted here. Production starts with no active pricing rules, so nothing can be
-- priced until AIEC approves rules and supplier prices.

-- ───────────── reference: component categories (synced by scripts/migrate.ts) ─────────────
create table component_categories (
  code text primary key check (code ~ '^[A-Z_]{2,40}$'),
  sort int not null default 0,
  is_safety_critical boolean not null default false,
  customer_editable boolean not null default false
);

-- ───────────── supplier marketplace status (separate from company KYC status) ─────────────
alter table companies
  add column marketplace_status text not null default 'PENDING'
    check (marketplace_status in ('PENDING','VERIFIED','APPROVED','PREFERRED','SUSPENDED')),
  add column marketplace_status_reason text,
  add column marketplace_reviewed_by uuid references users(id),
  add column marketplace_reviewed_at timestamptz;

alter table file_objects drop constraint file_objects_kind_check;
alter table file_objects add constraint file_objects_kind_check check (kind in (
  'LICENCE','INSURANCE','SURVEY','QUOTATION','CONTRACT','WORK_EVIDENCE','COLLECTION','COMPLIANCE','INCIDENT','PRODUCT','OTHER','SITE_PHOTO'));

-- ───────────── supplier products (individual approval) ─────────────
create table supplier_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  category_code text not null references component_categories(code),
  brand text not null check (length(brand) between 1 and 120),
  model text not null check (length(model) between 1 and 120),
  name text not null check (length(name) between 2 and 200),
  description text,
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  price_unit text not null default 'EACH' check (price_unit in ('EACH','PER_STOP','PER_TRAVEL_METRE')),
  warranty_months int not null default 12 check (warranty_months between 0 and 240),
  delivery_days int not null default 14 check (delivery_days between 0 and 365),
  stock_qty int not null default 0 check (stock_qty >= 0),
  approval_status text not null default 'DRAFT' check (approval_status in ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUSPENDED')),
  review_note text,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  image_file_id uuid references file_objects(id),
  document_file_id uuid references file_objects(id),
  is_demo boolean not null default false,
  deleted_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, category_code, brand, model)
);
create index supplier_products_cat_idx on supplier_products(category_code) where approval_status = 'APPROVED' and deleted_at is null;
create index supplier_products_status_idx on supplier_products(approval_status);

-- Price history: every change is a new row. The amount never changes after insertion.
create table supplier_product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references supplier_products(id),
  company_id uuid not null references companies(id),
  unit_price numeric(14,2) not null check (unit_price > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  valid_from date not null,
  valid_to date check (valid_to is null or valid_to >= valid_from),
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED','APPROVED','REJECTED','SUPERSEDED')),
  change_percent numeric(9,2),
  needs_review_reason text,
  note text,
  submitted_by uuid references users(id),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index supplier_prices_product_idx on supplier_product_prices(product_id, valid_from desc) where status = 'APPROVED';

create or replace function app.guard_price_row() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'APPEND_ONLY: price history rows are never deleted' using errcode = 'P0001'; end if;
  if new.unit_price is distinct from old.unit_price or new.product_id is distinct from old.product_id
     or new.valid_from is distinct from old.valid_from or new.company_id is distinct from old.company_id then
    raise exception 'APPEND_ONLY: a price amount never changes; submit a new price' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger supplier_prices_guard before update or delete on supplier_product_prices for each row execute function app.guard_price_row();

-- ───────────── packages ─────────────
create table lift_packages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('BASIC','STANDARD','PREMIUM','LUXURY')),
  tier int not null unique check (tier between 1 and 4),
  created_at timestamptz not null default now()
);

create table package_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references lift_packages(id),
  version_no int not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','RETIRED')),
  title text not null check (length(title) between 2 and 120),
  summary text,
  features text,
  exclusions text,
  warranty_months int not null default 12 check (warranty_months between 0 and 240),
  eligible_purposes text[] not null default '{}',
  min_stops int not null default 2 check (min_stops between 2 and 100),
  max_stops int not null default 10 check (max_stops between 2 and 100),
  max_speed_mps numeric(4,2) not null default 1.0 check (max_speed_mps between 0.1 and 10),
  min_load_kg int not null default 100 check (min_load_kg between 50 and 20000),
  max_load_kg int not null default 1000 check (max_load_kg between 50 and 20000),
  image_file_id uuid references file_objects(id),
  is_demo boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  published_by uuid references users(id),
  published_at timestamptz,
  retired_at timestamptz,
  unique (package_id, version_no),
  check (max_stops >= min_stops and max_load_kg >= min_load_kg)
);
create unique index package_one_published_uq on package_versions(package_id) where status = 'PUBLISHED';

create table package_slots (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references package_versions(id) on delete cascade,
  category_code text not null references component_categories(code),
  is_mandatory boolean not null default true,
  is_safety_critical boolean not null default false,
  customer_editable boolean not null default false,
  sort int not null default 0,
  unique (version_id, category_code),
  check (not is_safety_critical or (is_mandatory and not customer_editable))
);

create table package_slot_options (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references package_slots(id) on delete cascade,
  product_id uuid not null references supplier_products(id),
  kind text not null check (kind in ('STANDARD','UPGRADE','ALTERNATIVE')),
  unique (slot_id, product_id)
);
create unique index package_slot_one_standard_uq on package_slot_options(slot_id) where kind = 'STANDARD';

-- A published or retired package version is frozen (only PUBLISHED → RETIRED may change).
create or replace function app.guard_package_version() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then raise exception 'PACKAGE_LOCKED' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status <> 'DRAFT' and ((to_jsonb(new) - 'status' - 'retired_at') <> (to_jsonb(old) - 'status' - 'retired_at')
      or not (old.status = 'PUBLISHED' and new.status = 'RETIRED')) then
    raise exception 'PACKAGE_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger package_versions_guard before update or delete on package_versions for each row execute function app.guard_package_version();

create or replace function app.guard_package_child() returns trigger language plpgsql as $$
declare v_status text;
begin
  if tg_table_name = 'package_slots' then
    select status into v_status from package_versions where id = coalesce(new.version_id, old.version_id);
  else
    select pv.status into v_status from package_slots s join package_versions pv on pv.id = s.version_id
     where s.id = coalesce(new.slot_id, old.slot_id);
  end if;
  if v_status is not null and v_status <> 'DRAFT' then raise exception 'PACKAGE_LOCKED' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end $$;
create trigger package_slots_guard before insert or update or delete on package_slots for each row execute function app.guard_package_child();
create trigger package_options_guard before insert or update or delete on package_slot_options for each row execute function app.guard_package_child();

-- ───────────── versioned rules (params are frozen once a version leaves DRAFT) ─────────────
create table pricing_rule_versions (
  id uuid primary key default gen_random_uuid(),
  version_no int not null unique,
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','RETIRED')),
  params jsonb not null check (jsonb_typeof(params) = 'object'),
  note text,
  is_demo boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  activated_by uuid references users(id),
  activated_at timestamptz,
  retired_at timestamptz
);
create unique index pricing_one_active_uq on pricing_rule_versions((true)) where status = 'ACTIVE';

create table compatibility_rule_versions (
  id uuid primary key default gen_random_uuid(),
  version_no int not null unique,
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','RETIRED')),
  params jsonb not null check (jsonb_typeof(params) = 'object'),
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  activated_by uuid references users(id),
  activated_at timestamptz,
  retired_at timestamptz
);
create unique index compat_one_active_uq on compatibility_rule_versions((true)) where status = 'ACTIVE';

create or replace function app.guard_rule_version() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then raise exception 'RULES_LOCKED' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status <> 'DRAFT' and (new.params is distinct from old.params or new.version_no is distinct from old.version_no) then
    raise exception 'RULES_LOCKED' using errcode = 'P0001';
  end if;
  if old.status = 'RETIRED' and new.status <> 'RETIRED' then raise exception 'RULES_LOCKED' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger pricing_rules_guard before update or delete on pricing_rule_versions for each row execute function app.guard_rule_version();
create trigger compat_rules_guard before update or delete on compatibility_rule_versions for each row execute function app.guard_rule_version();

-- ───────────── customer project specification (building + lift requirements) ─────────────
alter table leads add column execution_model text check (execution_model is null or execution_model in ('AIEC_CONTRACT','MARKETPLACE'));

create table market_project_specs (
  lead_id uuid primary key references leads(id) on delete cascade,
  customer_id uuid not null references customers(id),
  building_age text not null default 'NEW' check (building_age in ('NEW','EXISTING')),
  purpose text not null check (purpose in ('PASSENGER','HOME','GOODS','HOSPITAL','ACCESSIBLE')),
  persons int check (persons is null or persons between 1 and 50),
  rated_load_kg int check (rated_load_kg is null or rated_load_kg between 50 and 10000),
  speed_mps numeric(4,2) check (speed_mps is null or speed_mps between 0.1 and 10),
  floors int check (floors is null or floors between 1 and 100),
  stops int check (stops is null or stops between 2 and 100),
  usage_frequency text not null default 'MEDIUM' check (usage_frequency in ('LOW','MEDIUM','HIGH')),
  accessibility boolean not null default false,
  special_requirements text,
  shaft_width_mm int check (shaft_width_mm is null or shaft_width_mm between 300 and 10000),
  shaft_depth_mm int check (shaft_depth_mm is null or shaft_depth_mm between 300 and 10000),
  pit_depth_mm int check (pit_depth_mm is null or pit_depth_mm between 0 and 10000),
  overhead_mm int check (overhead_mm is null or overhead_mm between 0 and 20000),
  power_supply text not null default 'UNKNOWN' check (power_supply in ('SINGLE_PHASE','THREE_PHASE','UNKNOWN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table market_site_photos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  customer_id uuid not null references customers(id),
  file_id uuid not null references file_objects(id),
  caption text,
  created_at timestamptz not null default now()
);
create index market_site_photos_lead_idx on market_site_photos(lead_id);

-- ───────────── configurations (cart and saved configurations) ─────────────
create sequence config_no_seq;
create table configurations (
  id uuid primary key default gen_random_uuid(),
  config_number text not null unique default app.next_no('CF', 'config_no_seq'),
  customer_id uuid not null references customers(id),
  lead_id uuid not null references leads(id) on delete cascade,
  package_version_id uuid not null references package_versions(id),
  name text not null check (length(name) between 1 and 120),
  status text not null default 'CART' check (status in ('CART','SAVED','QUOTED','ARCHIVED')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index configurations_lead_idx on configurations(lead_id);

create table configuration_items (
  configuration_id uuid not null references configurations(id) on delete cascade,
  slot_id uuid not null references package_slots(id),
  product_id uuid references supplier_products(id),
  primary key (configuration_id, slot_id)
);

-- ───────────── package quotations (immutable versions) ─────────────
create sequence market_quotation_no_seq;
create table market_quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_number text not null unique default app.next_no('MQ', 'market_quotation_no_seq'),
  configuration_id uuid not null references configurations(id),
  lead_id uuid not null references leads(id),
  customer_id uuid not null references customers(id),
  status text not null default 'ESTIMATE' check (status in (
    'ESTIMATE','PENDING_ENGINEERING','PENDING_OWNER_APPROVAL','ISSUED','ACCEPTED','DECLINED','REJECTED','EXPIRED','CANCELLED')),
  current_version_id uuid,
  accepted_version_id uuid,
  accepted_at timestamptz,
  accepted_by uuid references users(id),
  execution_model text check (execution_model is null or execution_model in ('AIEC_CONTRACT','MARKETPLACE')),
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index market_quotations_lead_idx on market_quotations(lead_id);
create index market_quotations_status_idx on market_quotations(status);

create table market_quotation_versions (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references market_quotations(id),
  version_no int not null,
  price_basis text not null check (price_basis in ('ESTIMATED','FINAL')),
  spec_source text not null check (spec_source in ('DECLARED','SURVEYED')),
  compat_status text not null check (compat_status in ('GREEN','YELLOW','RED')),
  pricing_rule_version_id uuid not null references pricing_rule_versions(id),
  compatibility_rule_version_id uuid not null references compatibility_rule_versions(id),
  -- customer-facing charges (cost + overhead + margin); they add up to selling_before_discount
  charge_materials numeric(14,2) not null check (charge_materials >= 0),
  charge_installation numeric(14,2) not null check (charge_installation >= 0),
  charge_transport numeric(14,2) not null check (charge_transport >= 0),
  charge_site_work numeric(14,2) not null check (charge_site_work >= 0),
  selling_before_discount numeric(14,2) not null check (selling_before_discount >= 0),
  discount_percent numeric(7,4) not null default 0 check (discount_percent >= 0 and discount_percent < 100),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  selling_price numeric(14,2) not null check (selling_price >= 0),
  gst_percent numeric(7,4) not null check (gst_percent >= 0),
  gst_amount numeric(14,2) not null check (gst_amount >= 0),
  total_payable numeric(14,2) not null check (total_payable >= 0),
  needs_owner_approval boolean not null default false,
  /** Customer-facing snapshot: customer, project, specification, package, lines, findings. No costs or margins. */
  snapshot jsonb not null,
  valid_until date not null,
  discount_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (quotation_id, version_no),
  check (selling_before_discount = charge_materials + charge_installation + charge_transport + charge_site_work),
  check (selling_price = selling_before_discount - discount_amount),
  check (total_payable = selling_price + gst_amount)
);
alter table market_quotations add constraint market_quotations_current_fk foreign key (current_version_id) references market_quotation_versions(id);
alter table market_quotations add constraint market_quotations_accepted_fk foreign key (accepted_version_id) references market_quotation_versions(id);
create trigger market_quotation_versions_immutable before update or delete on market_quotation_versions for each row execute function app.forbid_change();

-- Internal cost build-up of each version (AIEC staff only): supplier costs, overhead, margin, exceptions.
create table market_quotation_costs (
  version_id uuid primary key references market_quotation_versions(id),
  material_cost numeric(14,2) not null check (material_cost >= 0),
  installation_cost numeric(14,2) not null check (installation_cost >= 0),
  transport_cost numeric(14,2) not null check (transport_cost >= 0),
  site_work_cost numeric(14,2) not null check (site_work_cost >= 0),
  project_cost numeric(14,2) not null check (project_cost >= 0),
  overhead_amount numeric(14,2) not null check (overhead_amount >= 0),
  margin_amount numeric(14,2) not null,
  margin_percent numeric(9,4) not null,
  exceptions text[] not null default '{}',
  cost_lines jsonb not null,
  check (project_cost = material_cost + installation_cost + transport_cost + site_work_cost)
);
create trigger market_quotation_costs_immutable before update or delete on market_quotation_costs for each row execute function app.forbid_change();

create table market_quotation_approvals (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references market_quotations(id),
  version_id uuid not null references market_quotation_versions(id),
  kind text not null check (kind in ('ENGINEERING','PRICING_EXCEPTION')),
  decision text not null check (decision in ('APPROVED','REJECTED')),
  acknowledged_findings text[] not null default '{}',
  note text not null check (length(note) between 3 and 2000),
  decided_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (version_id, kind)
);
create trigger market_quotation_approvals_immutable before update or delete on market_quotation_approvals for each row execute function app.forbid_change();

-- ───────────── automation events (idempotent, auditable) ─────────────
create table automation_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[A-Z_]{3,60}$'),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  entity_type text not null,
  entity_id uuid,
  actor_id uuid references users(id),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'DONE' check (status in ('PENDING','DONE','FAILED')),
  attempts int not null default 1 check (attempts between 0 and 20),
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index automation_events_entity_idx on automation_events(entity_type, entity_id);
create index automation_events_failed_idx on automation_events(status) where status <> 'DONE';

-- ───────────── trusted read helpers (customers never read supplier costs or margins) ─────────────
-- Current approved cost of eligible products only: approved product, approved & active supplier,
-- not deleted, and an approved price valid today (latest valid_from wins).
create or replace function app.eligible_product_costs(p_ids uuid[])
returns table (product_id uuid, price_id uuid, unit_price numeric, valid_from date)
language sql stable security definer set search_path = public as $$
  select distinct on (sp.id) sp.id, pr.id, pr.unit_price, pr.valid_from
    from supplier_products sp
    join companies c on c.id = sp.company_id
    join supplier_product_prices pr on pr.product_id = sp.id and pr.status = 'APPROVED'
     and pr.valid_from <= (now() at time zone 'Asia/Kolkata')::date
     and (pr.valid_to is null or pr.valid_to >= (now() at time zone 'Asia/Kolkata')::date)
   where sp.id = any(p_ids) and sp.approval_status = 'APPROVED' and sp.deleted_at is null
     and c.status = 'ACTIVE' and c.marketplace_status in ('APPROVED','PREFERRED')
   order by sp.id, pr.valid_from desc, pr.created_at desc
$$;

create or replace function app.active_pricing_rules()
returns table (id uuid, version_no int, params jsonb)
language sql stable security definer set search_path = public as $$
  select id, version_no, params from pricing_rule_versions where status = 'ACTIVE'
$$;

grant execute on all functions in schema app to aiec_app;
grant select, insert, update, delete on all tables in schema public to aiec_app;
grant usage, select on all sequences in schema public to aiec_app;

-- ───────────── row-level security for the new tables ─────────────
do $$
declare
  i text := 'app.is_internal()';
  cnt text := '(company_id = app.company_id() and not app.is_technician())';
  u text := 'customer_id = app.customer_id()';
begin
  perform app.protect('component_categories', i, 'true');
  perform app.protect('supplier_products', i || ' or ' || cnt, 'approval_status = ''APPROVED'' and deleted_at is null');
  perform app.protect('supplier_product_prices', i || ' or ' || cnt);
  perform app.protect('lift_packages', i, 'true');
  perform app.protect('package_versions', i, 'status = ''PUBLISHED''');
  perform app.protect('package_slots', i, 'exists (select 1 from package_versions v where v.id = package_slots.version_id)');
  perform app.protect('package_slot_options', i, 'exists (select 1 from package_slots s where s.id = package_slot_options.slot_id)');
  perform app.protect('pricing_rule_versions', i);
  perform app.protect('compatibility_rule_versions', i, 'true');
  perform app.protect('market_project_specs', i || ' or ' || u);
  perform app.protect('market_site_photos', i || ' or ' || u);
  perform app.protect('configurations', i || ' or ' || u);
  perform app.protect('configuration_items', 'exists (select 1 from configurations c where c.id = configuration_items.configuration_id)');
  perform app.protect('market_quotations', i, u);
  perform app.protect('market_quotation_versions', i, 'exists (select 1 from market_quotations q where q.id = market_quotation_versions.quotation_id)');
  perform app.protect('market_quotation_costs', i);
  perform app.protect('market_quotation_approvals', i, 'exists (select 1 from market_quotations q where q.id = market_quotation_approvals.quotation_id)');
  perform app.insert_only('automation_events', i);
end $$;
