-- pgTAP: expansión del catálogo (moneda, Europa, Costa Oeste activa y norma de registro obligatorio).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select is((select array_agg(code order by code) from public.catalog_cities where region = 'us_west' and active),
          array['LAS', 'LAX', 'SFO'], 'la Costa Oeste está activa');
select is((select array_agg(code order by code) from public.catalog_cities where code in ('LON', 'PAR') and not active),
          array['LON', 'PAR'], 'Londres y París cargadas pero inactivas');
select is((select currency from public.catalog_cities where code = 'LON'), 'GBP', 'Londres en libras');
select is((select currency from public.catalog_cities where code = 'PAR'), 'EUR', 'París en euros');
select is((select count(*) from public.catalog_cities where region like 'us_%' and currency <> 'USD')::int, 0,
          'las ciudades de EE. UU. en dólares');
select is((select timezone from public.catalog_cities where code = 'PAR'), 'Europe/Paris', 'zona IANA de París');
select ok((select bool_and(timezone in (select name from pg_timezone_names)) from public.catalog_cities),
          'toda zona horaria existe en la base IANA');
select is((select source_kind from public.city_legal_rules where city_code = 'LAS'), 'official',
          'Las Vegas con fuente oficial');
select is((select rule from public.city_legal_rules where city_code = 'PAR'), 'short_term_rental_registration_required',
          'París exige registro');
select is((select count(*) from public.city_legal_rules where city_code = 'LON')::int, 0,
          'Londres sin regla por estadía (el tope anual es del anfitrión)');
select throws_ok($$ update public.city_legal_rules set value = 30 where city_code = 'PAR' $$, '23514', null,
                 'la regla de registro no tiene magnitud');
select throws_ok($$ update public.catalog_cities set currency = 'usd' where code = 'NYC' $$, '23514', null,
                 'moneda en código ISO 4217');

select * from finish();
rollback;
