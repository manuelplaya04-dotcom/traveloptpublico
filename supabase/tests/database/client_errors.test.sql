-- pgTAP: los errores del navegador solo los escribe el motor; nadie los lee ni escribe desde el navegador.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@test.local');
insert into public.client_errors (user_id, message) values ('11111111-1111-1111-1111-111111111111', 'boom');

select ok((select relrowsecurity from pg_class where oid = 'public.client_errors'::regclass), 'RLS activa');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.client_errors $$, '42501', null, 'authenticated no puede leer (ni sus propios errores)');
select throws_ok($$ insert into public.client_errors (user_id, message) values ('11111111-1111-1111-1111-111111111111', 'x') $$,
                 '42501', null, 'authenticated no puede escribir');
reset role;

set local role anon;
select throws_ok($$ select count(*) from public.client_errors $$, '42501', null, 'anon no puede leer');
reset role;

select * from finish();
rollback;
