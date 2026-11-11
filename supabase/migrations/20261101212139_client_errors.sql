-- Errores de render del navegador (Error Boundary). Solo los escribe el motor (conexión directa, rol del servicio);
-- RLS activa y sin políticas: nadie los lee ni escribe desde el navegador. Retención: 30 días (purge del motor).
create table public.client_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete cascade,
  message     text not null check (char_length(message) <= 500),
  digest      text check (char_length(digest) <= 64),
  path        text check (char_length(path) <= 200),
  created_at  timestamptz not null default now()
);

alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

create index client_errors_created_idx on public.client_errors (created_at);
