-- Links de solo lectura para compartir un itinerario con el grupo de viaje. Los crea y los lee SOLO el motor
-- (conexión directa): el navegador nunca toca esta tabla (RLS activa, sin políticas, sin privilegios), así que un token
-- no permite listar ni adivinar otros. El token es un UUID aleatorio (122 bits); la fila se borra con la búsqueda
-- (retención de 30 días) y además vence sola.
create table public.shared_itineraries (
  token       uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.search_runs (id) on delete cascade,
  created_by  uuid references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days'
);

alter table public.shared_itineraries enable row level security;
revoke all on public.shared_itineraries from anon, authenticated;

-- un link por corrida y usuario (volver a compartir devuelve el mismo)
create unique index shared_itineraries_run_user_idx on public.shared_itineraries (run_id, created_by);
