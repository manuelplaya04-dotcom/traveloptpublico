-- Catálogo de destinos y reglas legales por ciudad. Lectura pública (no hay datos de personas), escritura solo con
-- service_role: anon y authenticated no tienen ningún permiso de escritura, ni siquiera a nivel de GRANT.
--
-- `active`: la web solo ofrece las ciudades activas. Una ciudad inactiva existe (perfil y reglas listos) pero no se puede
-- elegir. La Costa Oeste entra inactiva hasta probarla.

create table public.catalog_cities (
  code              text primary key check (code ~ '^[A-Z]{2,5}$'),
  name              text not null check (char_length(name) between 1 and 40),
  country           text not null check (char_length(country) between 1 and 60),
  region            text not null check (region in ('us_east', 'us_west')),
  timezone          text not null check (char_length(timezone) between 3 and 64),  -- zona IANA de la ciudad
  airports          text[] not null check (cardinality(airports) between 1 and 5),
  lat               double precision not null check (lat between -90 and 90),
  lon               double precision not null check (lon between -180 and 180),
  default_nights    int not null check (default_nights between 1 and 21),
  -- cuántos imperdibles entran según las noches (índice = noches − 1; el último vale para más noches). Medido con el
  -- motor: pedir más vuelve infactible el viaje. null = entran todos.
  must_do_by_nights int[],
  same_area_as      text references public.catalog_cities (code),  -- comparte aeropuertos: no se combinan en un viaje
  active            boolean not null default false,
  position          int not null default 100
);

create table public.catalog_must_do (
  city_code    text not null references public.catalog_cities (code) on delete cascade,
  activity_key text not null check (activity_key ~ '^[A-Za-z0-9_-]{1,32}$'),
  rank         int not null check (rank >= 1),
  primary key (city_code, activity_key),
  unique (city_code, rank)
);

-- Reglas legales que el motor aplica como restricción dura. `short_term_rental_min_nights`: por debajo de esas noches el
-- alquiler temporario solo es legal con condiciones que el proveedor no informa (anfitrión registrado, licencia): el
-- motor lo descarta y quedan los hoteles. No es asesoramiento legal: `source_kind` dice qué tan firme es la fuente.
create table public.city_legal_rules (
  city_code   text not null references public.catalog_cities (code) on delete cascade,
  rule        text not null check (rule in ('short_term_rental_min_nights')),
  value       int not null check (value >= 1),
  note        text not null check (char_length(note) between 1 and 300),
  source_url  text not null check (source_url ~ '^https://'),
  source_kind text not null check (source_kind in ('official', 'secondary')),
  reviewed_on date not null,
  primary key (city_code, rule)
);

alter table public.catalog_cities enable row level security;
alter table public.catalog_must_do enable row level security;
alter table public.city_legal_rules enable row level security;

create policy catalog_cities_public_read on public.catalog_cities for select to anon, authenticated using (true);
create policy catalog_must_do_public_read on public.catalog_must_do for select to anon, authenticated using (true);
create policy city_legal_rules_public_read on public.city_legal_rules for select to anon, authenticated using (true);

-- Defensa en profundidad: además de RLS sin políticas de escritura, sin GRANT de escritura.
revoke all on public.catalog_cities, public.catalog_must_do, public.city_legal_rules from public, anon, authenticated;
grant select on public.catalog_cities, public.catalog_must_do, public.city_legal_rules to anon, authenticated;
grant select, insert, update, delete on public.catalog_cities, public.catalog_must_do, public.city_legal_rules to service_role;

insert into public.catalog_cities
  (code, name, country, region, timezone, airports, lat, lon, default_nights, must_do_by_nights, same_area_as, active, position)
values
  ('NYC', 'Nueva York', 'Estados Unidos', 'us_east', 'America/New_York', '{JFK,LGA,EWR}', 40.758, -73.9855, 4, '{0,2,3}', null, true, 10),
  ('ORL', 'Orlando', 'Estados Unidos', 'us_east', 'America/New_York', '{MCO}', 28.3852, -81.5639, 7, '{0,0,1,2,3,3,4,5}', null, true, 20),
  ('MIA', 'Miami', 'Estados Unidos', 'us_east', 'America/New_York', '{MIA}', 25.7617, -80.1918, 4, null, null, true, 30),
  ('PHL', 'Filadelfia', 'Estados Unidos', 'us_east', 'America/New_York', '{PHL}', 39.9526, -75.1652, 2, null, null, true, 40),
  ('BOS', 'Boston', 'Estados Unidos', 'us_east', 'America/New_York', '{BOS}', 42.3601, -71.0589, 3, null, null, true, 50),
  ('WAS', 'Washington D.C.', 'Estados Unidos', 'us_east', 'America/New_York', '{IAD,DCA}', 38.9072, -77.0369, 3, null, null, true, 60),
  ('LAX', 'Los Ángeles', 'Estados Unidos', 'us_west', 'America/Los_Angeles', '{LAX,BUR,SNA}', 34.0522, -118.2437, 4, null, null, false, 110),
  ('SFO', 'San Francisco', 'Estados Unidos', 'us_west', 'America/Los_Angeles', '{SFO,OAK}', 37.7749, -122.4194, 3, null, null, false, 120),
  ('LAS', 'Las Vegas', 'Estados Unidos', 'us_west', 'America/Los_Angeles', '{LAS}', 36.1147, -115.1728, 3, null, null, false, 130);

-- Brooklyn va después: referencia a Nueva York.
insert into public.catalog_cities
  (code, name, country, region, timezone, airports, lat, lon, default_nights, must_do_by_nights, same_area_as, active, position)
values ('BKN', 'Brooklyn', 'Estados Unidos', 'us_east', 'America/New_York', '{JFK,LGA}', 40.6782, -73.9442, 3, null, 'NYC', true, 70);

insert into public.catalog_must_do (city_code, activity_key, rank) values
  ('NYC', 'SOL', 1), ('NYC', 'TOR', 2), ('NYC', 'MOMA', 3),
  ('ORL', 'MK', 1), ('ORL', 'EPCOT', 2), ('ORL', 'HS', 3), ('ORL', 'AK', 4), ('ORL', 'EPIC', 5);

insert into public.city_legal_rules (city_code, rule, value, note, source_url, source_kind, reviewed_on) values
  ('NYC', 'short_term_rental_min_nights', 30,
   'Local Law 18: menos de 30 días solo con anfitrión registrado y presente; el proveedor no informa el registro.',
   'https://www.nyc.gov/site/specialenforcement/registration-law/registration.page', 'official', '2026-11-06'),
  ('BKN', 'short_term_rental_min_nights', 30,
   'Brooklyn es parte de Nueva York: rige Local Law 18.',
   'https://www.nyc.gov/site/specialenforcement/registration-law/registration.page', 'official', '2026-11-06'),
  ('LAX', 'short_term_rental_min_nights', 31,
   '30 días consecutivos o menos solo en residencia principal con registro de Home-Sharing; el proveedor no lo informa.',
   'https://planning.lacity.gov/ordinances/docs/HomeSharing/adopted/faq.pdf', 'official', '2026-11-06'),
  ('SFO', 'short_term_rental_min_nights', 30,
   'Menos de 30 noches solo con registro municipal; el proveedor no lo informa. Confirmar con la oficina de la ciudad.',
   'https://projects.sfplanning.org/community-stabilization/short-term-rental-regulations.htm', 'secondary', '2026-11-06'),
  ('LAS', 'short_term_rental_min_nights', 31,
   '30 días o menos requiere licencia comercial, que el proveedor no informa. Fuentes secundarias: confirmar con el condado de Clark y la ciudad.',
   'https://int.news3lv.com/news/local/clark-county-shares-faq-for-new-regulations-on-short-term-rentals', 'secondary', '2026-11-06');
