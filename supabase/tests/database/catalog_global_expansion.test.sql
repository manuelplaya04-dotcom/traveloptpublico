-- pgTAP: Patagonia y costa de Brasil activas, Europa cargada e inactiva, y las normas de registro de Ámsterdam y Brujas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select is((select array_agg(code order by code) from public.catalog_cities where region = 'ar_patagonia' and active),
          array['BAR', 'SMA', 'VLA', 'VPH'], 'Patagonia activa');
select is((select count(*) from public.catalog_cities where region = 'br_coast' and active)::int, 10, 'costa de Brasil activa');
select is((select array_agg(code order by code) from public.catalog_cities where code in ('MAD', 'BCN', 'IBZ', 'TFE', 'AMS', 'BRG') and not active),
          array['AMS', 'BCN', 'BRG', 'IBZ', 'MAD', 'TFE'], 'Europa nueva cargada pero inactiva');
select is((select count(*) from public.catalog_cities where region = 'br_coast' and currency <> 'BRL')::int, 0, 'Brasil en reales');
select is((select count(*) from public.catalog_cities where region = 'ar_patagonia' and currency <> 'ARS')::int, 0, 'Patagonia en pesos');
select is((select count(*) from public.catalog_cities where code in ('MAD', 'BCN', 'IBZ', 'TFE', 'AMS', 'BRG') and currency <> 'EUR')::int, 0,
          'Europa nueva en euros');
select ok((select bool_and(timezone in (select name from pg_timezone_names)) from public.catalog_cities), 'toda zona horaria existe');
-- Cada satélite comparte al menos un aeropuerto con su base (por eso no se combinan) y la base no es a su vez satélite.
select ok((select bool_and(s.airports && b.airports and b.same_area_as is null)
           from public.catalog_cities s join public.catalog_cities b on b.code = s.same_area_as),
          'los satélites comparten aeropuerto con una base');
select is((select array_agg(code order by code) from public.catalog_cities where same_area_as = 'RIO'),
          array['ARC', 'BUZ', 'CFR'], 'Búzios, Cabo Frío y Arraial do Cabo se visitan desde Río');
select is((select rule from public.city_legal_rules where city_code = 'AMS'), 'short_term_rental_registration_required',
          'Ámsterdam exige registro');
select is((select source_kind from public.city_legal_rules where city_code = 'BRG'), 'official', 'Brujas con fuente oficial');
select is((select count(*) from public.city_legal_rules where city_code in ('MAD', 'BCN', 'IBZ', 'TFE'))::int, 0,
          'España sin norma cargada todavía (pendiente de revisión: por eso inactiva)');
select throws_ok($$ update public.catalog_cities set region = 'asia' where code = 'BAR' $$, '23514', null,
                 'región fuera de la lista');

select * from finish();
rollback;
