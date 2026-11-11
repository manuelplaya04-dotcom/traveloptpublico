-- Endurecimiento tras el Security Advisor de producción (2026-10-31).

-- 1. `rls_auto_enable()` la crea Supabase al activar "Enable automatic RLS" en un proyecto nuevo. Es SECURITY DEFINER y
--    quedaba ejecutable por anon/authenticated vía /rest/v1/rpc. Sigue funcionando como event trigger (lo invoca el
--    servidor), pero nadie puede llamarla desde la API. En local no existe: por eso el bloque condicional.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- 2. Índices de las claves foráneas (norma 3). `user_id` es además la columna que filtran las políticas RLS.
create index if not exists trip_requests_user_idx on public.trip_requests (user_id);
create index if not exists itineraries_user_idx on public.itineraries (user_id);
create index if not exists search_runs_trip_request_idx on public.search_runs (trip_request_id);

-- 3. Defensa en profundidad: tablas y funciones nuevas nacen cerradas para el navegador, igual que en producción
--    ("Automatically expose new tables" desactivado). Cada migración da permisos explícitos donde hagan falta.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
