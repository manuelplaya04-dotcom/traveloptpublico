-- pgTAP: el catálogo y las reglas legales se leen sin sesión, pero solo service_role los puede escribir.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select ok((select relrowsecurity from pg_class where oid = 'public.catalog_cities'::regclass), 'RLS activa en ciudades');
select ok((select relrowsecurity from pg_class where oid = 'public.catalog_must_do'::regclass), 'RLS activa en imperdibles');
select ok((select relrowsecurity from pg_class where oid = 'public.city_legal_rules'::regclass), 'RLS activa en reglas');

-- Lectura pública
set local role anon;
select is((select count(*) from public.catalog_cities)::int, 12, 'anon lee las 12 ciudades');
select is((select count(*) from public.catalog_cities where active)::int, 10, 'activas: las 7 del este y las 3 del oeste (Europa todavía no)');
select is((select count(*) from public.catalog_must_do where city_code = 'ORL')::int, 5, 'anon lee los imperdibles');
select is((select value from public.city_legal_rules where city_code = 'NYC'), 30, 'anon lee las reglas');

-- Escritura bloqueada para anon
select throws_ok($$ insert into public.catalog_cities (code, name, country, region, timezone, airports, lat, lon, default_nights)
                    values ('XXX', 'X', 'X', 'us_east', 'UTC', '{XXX}', 0, 0, 1) $$, '42501', null, 'anon no inserta ciudades');
select throws_ok($$ update public.catalog_cities set active = true $$, '42501', null, 'anon no activa ciudades');
select throws_ok($$ delete from public.city_legal_rules $$, '42501', null, 'anon no borra reglas');
select throws_ok($$ update public.city_legal_rules set value = 1 $$, '42501', null, 'anon no relaja reglas');
select throws_ok($$ insert into public.catalog_must_do values ('NYC', 'X', 9) $$, '42501', null, 'anon no agrega imperdibles');
reset role;

-- Escritura bloqueada para sesiones (incluye las anónimas de la web)
set local role authenticated;
select throws_ok($$ update public.city_legal_rules set value = 1 $$, '42501', null, 'authenticated no relaja reglas');
select throws_ok($$ delete from public.catalog_cities $$, '42501', null, 'authenticated no borra ciudades');
select throws_ok($$ insert into public.catalog_must_do values ('NYC', 'X', 9) $$, '42501', null, 'authenticated no agrega imperdibles');
select is((select count(*) from public.catalog_cities)::int, 12, 'authenticated lee');
reset role;

-- Service role escribe
set local role service_role;
select lives_ok($$ update public.catalog_cities set position = position where code = 'NYC' $$, 'service_role escribe');
reset role;

-- Datos
select is((select count(*) from public.catalog_cities c where not exists
  (select 1 from public.city_legal_rules r where r.city_code = c.code) and c.region = 'us_west')::int, 0,
  'toda ciudad de la costa oeste tiene su regla');
select is((select value from public.city_legal_rules where city_code = 'LAX'), 31, 'Los Ángeles: 30 días o menos requiere registro');
select throws_ok($$ insert into public.city_legal_rules values ('NYC', 'otra_regla', 1, 'n', 'https://x.test', 'official', now()) $$,
                 '23514', null, 'solo tipos de regla conocidos');
select throws_ok($$ update public.city_legal_rules set source_url = 'javascript:alert(1)' where city_code = 'NYC' $$,
                 '23514', null, 'la fuente tiene que ser https');

select * from finish();
rollback;
