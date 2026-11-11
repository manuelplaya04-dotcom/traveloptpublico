-- pgTAP: aislamiento entre usuarios y superficie mínima para el navegador.
-- Ejecutar: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local');
insert into public.trip_requests (id, user_id, payload) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '{}');
insert into public.search_runs (id, trip_request_id, user_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into public.itineraries (run_id, rank, user_id, skeleton_id, total_minor, within_budget, payload) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 1, '11111111-1111-1111-1111-111111111111', 'x', 100, true, '{}');
insert into public.run_offers (run_id, kind, offer_id, provider, payload) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'flights', 'F1', 'fixture', '{}');

-- Usuario B
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from public.search_runs), 0, 'B no ve corridas de A');
select is((select count(*)::int from public.itineraries), 0, 'B no ve itinerarios de A');
select is((select count(*)::int from public.run_offers), 0, 'B no ve ofertas de A');

-- Usuario A
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is((select count(*)::int from public.search_runs), 1, 'A ve su corrida');
select is((select count(*)::int from public.itineraries), 1, 'A ve su itinerario');
select throws_ok(
  $$ update public.search_runs set status = 'done' $$,
  '42501', null, 'authenticated no puede modificar corridas');
select throws_ok(
  $$ select * from public.api_cache $$,
  '42501', null, 'api_cache no es accesible desde el navegador');
select is((select count(*)::int from public.run_offers), 1, 'A ve las ofertas de su corrida');
select throws_ok(
  $$ delete from public.run_offers $$,
  '42501', null, 'authenticated no puede borrar ofertas');

-- Anónimo sin sesión (rol anon, no confundir con "anonymous sign-in", que es authenticated)
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.search_runs $$,
  '42501', null, 'anon no tiene acceso a corridas');

select * from finish();
rollback;
