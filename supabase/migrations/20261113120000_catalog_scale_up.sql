-- Expansión del catálogo: moneda local de cada ciudad (dato informativo), región Europa, Costa Oeste activa, Londres y
-- París cargadas inactivas (se activan al probarlas de punta a punta) y una forma nueva de norma legal.
--
-- Idempotente: se puede correr varias veces sin duplicar ni fallar (ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS
-- antes de recrear cada CHECK, ON CONFLICT en los INSERT y UPDATE con valores fijos).
--
-- Hoteles y atracciones NO se siembran: los hoteles (con precio y disponibilidad) llegan en vivo del proveedor y las
-- atracciones con coordenadas salen de Wikidata para cualquier ciudad. Una copia fija acá quedaría vieja y el motor no
-- la usaría.

-- Moneda local (ISO 4217). Solo informativa: el motor cotiza y concilia en USD.
alter table public.catalog_cities add column if not exists currency text not null default 'USD';
alter table public.catalog_cities drop constraint if exists catalog_cities_currency_check;
alter table public.catalog_cities add constraint catalog_cities_currency_check check (currency ~ '^[A-Z]{3}$');

alter table public.catalog_cities drop constraint if exists catalog_cities_region_check;
alter table public.catalog_cities add constraint catalog_cities_region_check
  check (region in ('us_east', 'us_west', 'europe'));

-- `short_term_rental_registration_required`: todo alquiler de vivienda entera a turistas exige un número de registro de
-- la ciudad, sin importar las noches. El proveedor no lo informa: el motor descarta esos alquileres. Su `value` es
-- siempre 1 (la regla no tiene magnitud).
alter table public.city_legal_rules drop constraint if exists city_legal_rules_rule_check;
alter table public.city_legal_rules add constraint city_legal_rules_rule_check
  check (rule in ('short_term_rental_min_nights', 'short_term_rental_registration_required'));
alter table public.city_legal_rules drop constraint if exists city_legal_rules_registration_value_check;
alter table public.city_legal_rules add constraint city_legal_rules_registration_value_check
  check (rule <> 'short_term_rental_registration_required' or value = 1);

-- Europa, inactiva. Centro de referencia: Trafalgar Square y el Hôtel de Ville.
insert into public.catalog_cities
  (code, name, country, region, timezone, airports, lat, lon, default_nights, must_do_by_nights, same_area_as, active, position, currency)
values
  ('LON', 'Londres', 'Reino Unido', 'europe', 'Europe/London', '{LHR,LGW,STN,LTN,LCY}', 51.508, -0.1281, 4, null, null, false, 210, 'GBP'),
  ('PAR', 'París', 'Francia', 'europe', 'Europe/Paris', '{CDG,ORY}', 48.8566, 2.3522, 4, null, null, false, 220, 'EUR')
on conflict (code) do nothing;

-- Costa Oeste: lista para buscar.
update public.catalog_cities set active = true where code in ('LAX', 'SFO', 'LAS') and not active;

-- Las Vegas: fuente oficial del condado de Clark (antes, secundaria). Mismo mínimo: hasta 30 días consecutivos es
-- alquiler temporario y exige licencia (con cupo), que el proveedor no informa.
insert into public.city_legal_rules (city_code, rule, value, note, source_url, source_kind, reviewed_on) values
  ('LAS', 'short_term_rental_min_nights', 31,
   'Condado de Clark: 30 días consecutivos o menos es alquiler temporario y exige licencia comercial con cupo; el proveedor no la informa.',
   'https://www.clarkcountynv.gov/business/doing_business_with_clark_county/divisions/regulated_business/short_term_rentals/frequently-asked-questions',
   'official', '2026-11-13')
on conflict (city_code, rule) do update
  set value = excluded.value, note = excluded.note, source_url = excluded.source_url,
      source_kind = excluded.source_kind, reviewed_on = excluded.reviewed_on;

-- París: toda vivienda entera alquilada a turistas (por día, semana o mes) es meublé de tourisme y exige número de
-- registro; además, 90 noches por año si es residencia principal y cambio de uso si no lo es.
-- Londres no lleva regla: el tope de 90 noches por año (Deregulation Act 2015, s. 44) es de la propiedad y lo controla
-- el anfitrión; no limita la estadía de quien viaja, así que no hay nada que el motor pueda filtrar.
insert into public.city_legal_rules (city_code, rule, value, note, source_url, source_kind, reviewed_on) values
  ('PAR', 'short_term_rental_registration_required', 1,
   'Meublé de tourisme: número de registro obligatorio en cada anuncio (90 noches/año en residencia principal; cambio de uso en las demás). El proveedor no lo informa.',
   'https://www.paris.fr/meubles-touristiques', 'official', '2026-11-13')
on conflict (city_code, rule) do nothing;
