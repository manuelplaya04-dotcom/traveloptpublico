-- pgTAP: la clave seudónima de la conexión solo la usa el motor; desde la API pública no se lee ni se escribe.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@test.local');
insert into public.trip_requests (id, user_id, payload)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '{}');
insert into public.search_runs (id, trip_request_id, user_id, mode)
  values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111', 'fixture');
insert into public.run_clients (run_id, client_key)
  values ('33333333-3333-3333-3333-333333333333', '0123456789abcdef0123456789abcdef');

select ok((select relrowsecurity from pg_class where oid = 'public.run_clients'::regclass), 'RLS activa');

-- Ni el dueño de la corrida la ve
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.run_clients $$, '42501', null, 'el dueño no puede leer su clave');
select throws_ok($$ insert into public.run_clients values ('33333333-3333-3333-3333-333333333333', '0123456789abcdef0123456789abcdef', now()) $$,
                 '42501', null, 'authenticated no escribe');
select throws_ok($$ delete from public.run_clients $$, '42501', null, 'authenticated no borra');
reset role;

set local role anon;
select throws_ok($$ select count(*) from public.run_clients $$, '42501', null, 'anon no lee');
reset role;

select throws_ok($$ insert into public.run_clients values ('33333333-3333-3333-3333-333333333333', '192.168.0.1', now()) $$,
                 '23514', null, 'solo claves seudónimas, nunca una IP');

delete from public.search_runs where id = '33333333-3333-3333-3333-333333333333';
select is((select count(*) from public.run_clients)::int, 0, 'se borra con la búsqueda');

select * from finish();
rollback;
