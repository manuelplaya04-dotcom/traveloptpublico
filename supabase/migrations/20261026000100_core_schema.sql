-- TravelOpt · esquema núcleo
-- Escritor único: el motor (rol postgres vía DATABASE_URL). El navegador solo LEE lo suyo (RLS).

create type public.run_status as enum ('queued', 'extracting', 'optimizing', 'done', 'infeasible', 'failed');
create type public.run_mode   as enum ('fixture', 'hybrid', 'live');

create table public.trip_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete cascade,
  case_key   text,
  payload    jsonb not null,                       -- TripRequest validado por Pydantic
  created_at timestamptz not null default now()
);

create table public.search_runs (
  id              uuid primary key default gen_random_uuid(),
  trip_request_id uuid not null references public.trip_requests (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete cascade,   -- desnormalizado: RLS y Realtime
  status          public.run_status not null default 'queued',
  mode            public.run_mode   not null default 'fixture',
  summary         jsonb not null default '{}'::jsonb,                  -- plan de consultas, embudo, stats
  error           jsonb,
  timings         jsonb not null default '{}'::jsonb,                  -- timestamp de entrada a cada estado
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index search_runs_user_idx   on public.search_runs (user_id, created_at desc);
create index search_runs_active_idx on public.search_runs (updated_at) where status in ('queued', 'extracting', 'optimizing');

create table public.run_offers (
  run_id     uuid not null references public.search_runs (id) on delete cascade,
  kind       text not null check (kind in ('flights', 'lodging', 'activities', 'weather', 'transport')),
  offer_id   text not null,
  provider   text not null,
  payload    jsonb not null,                       -- modelo canónico (FlightOffer, LodgingOffer, ...)
  created_at timestamptz not null default now(),
  primary key (run_id, kind, offer_id)             -- upsert idempotente ante reintentos de n8n
);

create table public.itineraries (
  run_id        uuid not null references public.search_runs (id) on delete cascade,
  rank          smallint not null check (rank >= 1),
  user_id       uuid references auth.users (id) on delete cascade,
  skeleton_id   text not null,
  total_minor   bigint not null check (total_minor >= 0),
  currency      char(3) not null default 'USD',
  within_budget boolean not null,
  payload       jsonb not null,                    -- itinerario + calculadora financiera
  created_at    timestamptz not null default now(),
  primary key (run_id, rank)
);

create table public.api_cache (
  cache_key  text primary key,                     -- sha256(proveedor|endpoint|params sin credenciales)
  provider   text not null,
  payload    jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz                           -- null = no expira (clima histórico)
);
create index api_cache_expiry_idx on public.api_cache (expires_at) where expires_at is not null;

create table public.api_usage (
  id          bigint generated always as identity primary key,
  provider    text not null,
  endpoint    text not null,
  status_code int,
  latency_ms  int,
  run_id      uuid,
  called_at   timestamptz not null default now()
);
create index api_usage_provider_idx on public.api_usage (provider, called_at desc);

-- updated_at automático (lo usa el "reaper" de corridas colgadas)
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger search_runs_touch before update on public.search_runs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- seguridad
alter table public.trip_requests enable row level security;
alter table public.search_runs   enable row level security;
alter table public.run_offers    enable row level security;
alter table public.itineraries   enable row level security;
alter table public.api_cache     enable row level security;
alter table public.api_usage     enable row level security;

-- Defensa en profundidad: además de RLS, el navegador no tiene privilegios de escritura.
revoke all on public.trip_requests, public.search_runs, public.run_offers,
              public.itineraries, public.api_cache, public.api_usage from anon, authenticated;
grant select on public.trip_requests, public.search_runs, public.itineraries to authenticated;

create policy "own trip requests" on public.trip_requests
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own runs" on public.search_runs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own itineraries" on public.itineraries
  for select to authenticated using (user_id = (select auth.uid()));
-- run_offers, api_cache, api_usage: sin políticas ni grants => invisibles fuera del backend.

-- Realtime: el frontend escucha cambios de estado de SU corrida (respeta RLS).
alter publication supabase_realtime add table public.search_runs;
