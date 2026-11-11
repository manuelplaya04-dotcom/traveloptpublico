-- Límite de búsquedas por conexión (además del límite por sesión y del global). La web manda una clave seudónima:
-- HMAC-SHA256 de la IP con un secreto del servidor, recortado a 128 bits. La IP nunca viaja ni se guarda en claro
-- (Ley 25.326: minimización), y sin el secreto la clave no permite recuperarla.
--
-- Tabla aparte de search_runs: el dueño de una corrida puede leer su fila de search_runs, pero esta clave no la ve
-- nadie desde la API pública. Solo la usa el motor (conexión directa) y se borra a las 24 h: para limitar por hora no
-- hace falta más.

create table public.run_clients (
  run_id     uuid primary key references public.search_runs (id) on delete cascade,
  client_key text not null check (client_key ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now()
);

create index run_clients_key_time_idx on public.run_clients (client_key, created_at);

alter table public.run_clients enable row level security;
-- Sin políticas y sin GRANT: anon y authenticated no pueden ni leerla ni escribirla.
revoke all on public.run_clients from public, anon, authenticated;
