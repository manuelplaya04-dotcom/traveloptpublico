-- Fase 4b.2: el hub de vuelos y el dashboard por ciudad muestran las ofertas de la corrida.
-- Cada usuario lee SOLO las ofertas de sus propias corridas; escribir sigue siendo exclusivo del motor.
grant select on public.run_offers to authenticated;

create policy "own run offers" on public.run_offers
  for select to authenticated
  using (exists (
    select 1 from public.search_runs r
    where r.id = run_offers.run_id and r.user_id = (select auth.uid())
  ));
