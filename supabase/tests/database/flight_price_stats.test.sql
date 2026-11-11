-- pgTAP: estadística de precios del asesor de momento óptimo (cálculo en Postgres, sin datos de prueba ni duplicados).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.trip_requests (id, payload) values ('22222222-2222-2222-2222-222222222222', '{}');
insert into public.search_runs (id, trip_request_id, mode) values
  ('33333333-3333-3333-3333-333333333331', '22222222-2222-2222-2222-222222222222', 'hybrid'),
  ('33333333-3333-3333-3333-333333333332', '22222222-2222-2222-2222-222222222222', 'hybrid');

-- 3 cotizaciones reales distintas (precios 100..500 USD) de ZZA -> ZZB del 2030-01-15, una repetida en otra corrida
-- (la misma respuesta cacheada: cuenta una vez), un dato de prueba y otra ruta (no cuentan).
insert into public.run_offers (run_id, kind, offer_id, provider, payload)
select '33333333-3333-3333-3333-333333333331', 'flights', 'f' || i, 'serpapi_google_flights',
       jsonb_build_object('origin', 'ZZA', 'destination', 'ZZB', 'depart_at', '2030-01-15T09:00:00',
                          'price_per_pax_minor', i * 10000, 'fetched_at', '2029-12-0' || (i % 3 + 1) || 'T10:00:00Z')
from generate_series(1, 5) i;
insert into public.run_offers (run_id, kind, offer_id, provider, payload)
select '33333333-3333-3333-3333-333333333332', kind, offer_id, provider, payload
from public.run_offers where run_id = '33333333-3333-3333-3333-333333333331';
insert into public.run_offers (run_id, kind, offer_id, provider, payload) values
  ('33333333-3333-3333-3333-333333333332', 'flights', 'demo', 'simulado',
   '{"origin":"ZZA","destination":"ZZB","depart_at":"2030-01-15T09:00:00","price_per_pax_minor":1,"fetched_at":"2029-12-01T10:00:00Z"}'),
  ('33333333-3333-3333-3333-333333333332', 'flights', 'otra', 'serpapi_google_flights',
   '{"origin":"ZZA","destination":"ZZC","depart_at":"2030-01-15T09:00:00","price_per_pax_minor":1,"fetched_at":"2029-12-01T10:00:00Z"}');

select is((select observations from public.flight_price_stats('ZZA', 'ZZB', '2030-01-15')), 5,
          'cada cotización real cuenta una vez (sin duplicados entre corridas, sin datos de prueba ni otras rutas)');
select is((select snapshots from public.flight_price_stats('ZZA', 'ZZB', '2030-01-15')), 3, 'momentos de cotización distintos');
select is((select median from public.flight_price_stats('ZZA', 'ZZB', '2030-01-15')), 30000::numeric, 'mediana exacta');
select is((select p20 from public.flight_price_stats('ZZA', 'ZZB', '2030-01-15')), 18000::numeric, 'percentil 20 interpolado');
select is((select observations from public.flight_price_stats('ZZA', 'ZZB', '2030-01-16')), 0, 'otra fecha: sin historial (cold start)');

set local role authenticated;
select throws_ok($$ select * from public.flight_price_stats('ZZA', 'ZZB', '2030-01-15') $$, '42501', null,
                 'el navegador no puede ejecutarla');
reset role;

select ok(exists (select 1 from pg_indexes where indexname = 'run_offers_flight_route_idx'), 'índice por ruta y día');

select * from finish();
rollback;
