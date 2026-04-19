-- Amber Office — Order Tracking System
-- Project: order-tracking-amber

-- Users
create table if not exists users (
  id           uuid primary key default gen_random_uuid(),
  username     text not null unique,
  password_hash text not null,
  role         text not null default 'worker'
                 check (role in ('worker', 'admin', 'super_admin')),
  display_name text,
  created_at   timestamptz not null default now()
);

-- Orders
create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         text not null unique,
  customer         text not null,
  product          text not null,            -- summary / first item name
  quantity         int  not null,            -- total qty across all items
  items            jsonb,                    -- [{product, quantity}, ...]
  workstations     jsonb,                    -- ['Cut','Edge', ...] selected stations
  attachments      jsonb,                    -- [{name, url, type, size}, ...]
  due_date         date not null,
  status           text not null default 'pending'
                     check (status in ('pending','in_progress','ready','pickup_delivery','done','cancelled')),
  urgent           boolean not null default false,
  hidden           boolean not null default false,
  delete_requested boolean not null default false,
  shipped_at       timestamptz,              -- set when status → done
  created_at       timestamptz not null default now()
);

-- Work orders (one per order × workstation)
create table if not exists work_orders (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  workstation  text not null
                 check (workstation in ('Cut','Edge','Boring','Cut-Curve','Edge-Curve','Assembly','Packing')),
  worker_name  text,
  status       text not null default 'pending'
                 check (status in ('pending','in_progress','paused','completed')),
  target_qty   int  not null,
  actual_qty   int  not null default 0,
  rework_qty   int  not null default 0,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Action log (every worker action)
create table if not exists work_logs (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  action        text not null check (action in ('start','pause','resume','complete','rework')),
  worker_name   text,
  note          text,
  qty           int,
  timestamp     timestamptz not null default now()
);

-- AI weekly reports
create table if not exists weekly_reports (
  id           uuid primary key default gen_random_uuid(),
  week_start   date not null,
  week_end     date not null,
  content      text not null,
  generated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_orders_status       on orders(status);
create index if not exists idx_orders_due_date     on orders(due_date);
create index if not exists idx_orders_hidden       on orders(hidden);
create index if not exists idx_orders_urgent       on orders(urgent);
create index if not exists idx_wo_order_id         on work_orders(order_id);
create index if not exists idx_wo_workstation_status on work_orders(workstation, status);
create index if not exists idx_work_logs_wo        on work_logs(work_order_id);
