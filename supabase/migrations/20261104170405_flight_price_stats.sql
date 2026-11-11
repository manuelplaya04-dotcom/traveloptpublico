-- Asesor de momento óptimo: distribución histórica de precios reales de una ruta y fecha de salida (últimos 30 días,
-- lo que dura la retención). El cálculo lo hace Postgres (percentiles exactos, sin traer filas al motor).
--
-- Observación = un precio real cotizado: (oferta, momento de cotización). La misma respuesta cacheada que aparece en
-- varias búsquedas cuenta UNA vez (distinct), así no se infla el historial. Los datos de prueba (fixture, simulado)
-- no cuentan. `snapshots` = momentos de cotización distintos: con menos de 3 el motor no da consejo (cold start).
-- Mediana y percentiles: robustos ante precios anómalos (un promedio se rompe con uno solo).

-- Búsqueda por ruta y día sin recorrer la tabla. left(…, 10) en vez de ::date: la conversión de texto a fecha no es
-- inmutable y no se puede indexar.
create index run_offers_flight_route_idx on public.run_offers
  ((payload ->> 'origin'), (payload ->> 'destination'), (left(payload ->> 'depart_at', 10)), created_at)
  where kind = 'flights';

create function public.flight_price_stats(p_origin text, p_destination text, p_day text, p_days int default 30)
returns table (snapshots int, observations int, p20 numeric, median numeric, p80 numeric)
language sql
stable
set search_path = ''
as $$
  with obs as (
    select distinct o.offer_id, o.payload ->> 'fetched_at' as fetched_at, (o.payload ->> 'price_per_pax_minor')::int as price
    from public.run_offers o
    where o.kind = 'flights'
      and o.provider not in ('fixture', 'simulado')
      and o.created_at > now() - make_interval(days => p_days)
      and o.payload ->> 'origin' = p_origin
      and o.payload ->> 'destination' = p_destination
      and left(o.payload ->> 'depart_at', 10) = p_day
      and o.payload ->> 'fetched_at' is not null
  )
  select count(distinct fetched_at)::int,
         count(*)::int,
         (percentile_cont(0.2) within group (order by price))::numeric,
         (percentile_cont(0.5) within group (order by price))::numeric,
         (percentile_cont(0.8) within group (order by price))::numeric
  from obs
$$;

-- Solo el motor (conexión directa) la usa: el navegador no puede ejecutarla.
revoke execute on function public.flight_price_stats(text, text, text, int) from public, anon, authenticated;
