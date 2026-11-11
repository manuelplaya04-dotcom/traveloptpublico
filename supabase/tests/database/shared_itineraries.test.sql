-- pgTAP: los links compartidos solo los crea y lee el motor; desde el navegador no se listan ni se escriben.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@test.local');
insert into public.trip_requests (id, user_id, payload)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '{}');
insert into public.search_runs (id, trip_request_id, user_id, mode)
  values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111', 'fixture');
insert into public.shared_itineraries (run_id, created_by)
  values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');

select ok((select relrowsecurity from pg_class where oid = 'public.shared_itineraries'::regclass), 'RLS activa');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.shared_itineraries $$, '42501', null, 'authenticated no puede listar (ni los propios)');
select throws_ok($$ insert into public.shared_itineraries (run_id) values ('33333333-3333-3333-3333-333333333333') $$,
                 '42501', null, 'authenticated no puede crear');
reset role;

set local role anon;
select throws_ok($$ select count(*) from public.shared_itineraries $$, '42501', null, 'anon no puede leer');
reset role;

delete from public.search_runs where id = '33333333-3333-3333-3333-333333333333';
select is((select count(*) from public.shared_itineraries
            where run_id = '33333333-3333-3333-3333-333333333333')::int, 0, 'se borra con la búsqueda (retención)');

select * from finish();
rollback;
