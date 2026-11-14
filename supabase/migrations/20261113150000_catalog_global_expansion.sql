-- Expansión del catálogo: Patagonia argentina y costa de Brasil (activas) y seis destinos europeos (inactivos), más las
-- normas de alquiler temporario de Ámsterdam y Brujas.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS antes de recrear el CHECK, ON CONFLICT DO NOTHING en cada INSERT (correrla dos
-- veces deja el estado idéntico; no pisa una ciudad que ya se haya editado a mano). Volumen chico (20 filas en 6
-- sentencias): no hay riesgo de memoria ni de timeout en el plan gratuito, así que no hace falta partir en lotes.
--
-- Modelo de "zona": el motor une ciudades con vuelos. Las que se visitan desde el aeropuerto de otra (Búzios desde Río,
-- Villa La Angostura desde Bariloche) llevan `same_area_as` y no se combinan en un mismo viaje: son bases alternativas.
-- Las ciudades raíz van en una sentencia anterior a las que las referencian.
--
-- Sin imperdibles sembrados: cada imperdible necesita un precio publicado y verificable en
-- engine/app/data/curated_activities_pricing.json (test_curated). Las atracciones reales con coordenadas llegan de
-- Wikidata para cualquier ciudad ("Lugares para conocer", sin sumar un monto inventado).
--
-- Europa queda inactiva hasta probarla de punta a punta y revisar las normas españolas: el registro único nacional
-- (Real Decreto 1312/2024) fue anulado por el Tribunal Supremo en mayo de 2026 según fuentes secundarias, y rigen las
-- normas de cada comunidad (Cataluña, Baleares, Canarias, Madrid), todavía sin cargar.

alter table public.catalog_cities drop constraint if exists catalog_cities_region_check;
alter table public.catalog_cities add constraint catalog_cities_region_check
  check (region in ('us_east', 'us_west', 'europe', 'ar_patagonia', 'br_coast'));

-- Patagonia argentina (centro de referencia: el centro cívico o la plaza de cada localidad).
insert into public.catalog_cities
  (code, name, country, region, timezone, airports, lat, lon, default_nights, must_do_by_nights, same_area_as, active, position, currency)
values
  ('BAR', 'Bariloche', 'Argentina', 'ar_patagonia', 'America/Argentina/Salta', '{BRC}', -41.1335, -71.3103, 5, null, null, true, 300, 'ARS'),
  ('SMA', 'San Martín de los Andes', 'Argentina', 'ar_patagonia', 'America/Argentina/Salta', '{CPC}', -40.1575, -71.3532, 4, null, null, true, 310, 'ARS')
on conflict (code) do nothing;

insert into public.catalog_cities
  (code, name, country, region, timezone, airports, lat, lon, default_nights, must_do_by_nights, same_area_as, active, position, currency)
values
  ('VLA', 'Villa La Angostura', 'Argentina', 'ar_patagonia', 'America/Argentina/Salta', '{BRC}', -40.7616, -71.6463, 3, null, 'BAR', true, 320, 'ARS'),
  ('VPH', 'Villa Pehuenia', 'Argentina', 'ar_patagonia', 'America/Argentina/Salta', '{CPC,NQN}', -38.8829, -71.1719, 3, null, 'SMA', true, 330, 'ARS')
on conflict (code) do nothing;

-- Costa de Brasil. Arapiraca no es costera (agreste de Alagoas): se llega por Maceió. Canasvieiras es un barrio de
-- playa de Florianópolis (aeropuerto FLN).
insert into public.catalog_cities
  (code, name, country, region, timezone, airports, lat, lon, default_nights, must_do_by_nights, same_area_as, active, position, currency)
values
  ('RIO', 'Río de Janeiro', 'Brasil', 'br_coast', 'America/Sao_Paulo', '{GIG,SDU}', -22.9068, -43.1729, 5, null, null, true, 400, 'BRL'),
  ('SSA', 'Salvador', 'Brasil', 'br_coast', 'America/Bahia', '{SSA}', -12.9777, -38.5016, 5, null, null, true, 410, 'BRL'),
  ('MCZ', 'Maceió', 'Brasil', 'br_coast', 'America/Maceio', '{MCZ}', -9.6658, -35.7353, 5, null, null, true, 420, 'BRL'),
  ('AJU', 'Aracaju', 'Brasil', 'br_coast', 'America/Maceio', '{AJU}', -10.9472, -37.0731, 4, null, null, true, 430, 'BRL'),
  ('CNV', 'Canasvieiras', 'Brasil', 'br_coast', 'America/Sao_Paulo', '{FLN}', -27.4297, -48.4617, 7, null, null, true, 440, 'BRL')
on conflict (code) do nothing;

insert into public.catalog_cities
  (code, name, country, region, timezone, airports, lat, lon, default_nights, must_do_by_nights, same_area_as, active, position, currency)
values
  ('BUZ', 'Búzios', 'Brasil', 'br_coast', 'America/Sao_Paulo', '{CFB,GIG}', -22.7469, -41.8817, 4, null, 'RIO', true, 450, 'BRL'),
  ('CFR', 'Cabo Frío', 'Brasil', 'br_coast', 'America/Sao_Paulo', '{CFB,GIG}', -22.8794, -42.0186, 3, null, 'RIO', true, 460, 'BRL'),
  ('ARC', 'Arraial do Cabo', 'Brasil', 'br_coast', 'America/Sao_Paulo', '{CFB,GIG}', -22.9661, -42.0278, 3, null, 'RIO', true, 470, 'BRL'),
  ('CAM', 'Camaçari', 'Brasil', 'br_coast', 'America/Bahia', '{SSA}', -12.6996, -38.3263, 3, null, 'SSA', true, 480, 'BRL'),
  ('ARA', 'Arapiraca', 'Brasil', 'br_coast', 'America/Maceio', '{MCZ}', -9.7525, -36.6611, 2, null, 'MCZ', true, 490, 'BRL')
on conflict (code) do nothing;

-- Europa, inactiva. "Islas Canarias" es un archipiélago: se carga Tenerife (Santa Cruz), con sus dos aeropuertos.
-- Brujas no tiene aeropuerto propio: Bruselas queda a ~100 km.
insert into public.catalog_cities
  (code, name, country, region, timezone, airports, lat, lon, default_nights, must_do_by_nights, same_area_as, active, position, currency)
values
  ('MAD', 'Madrid', 'España', 'europe', 'Europe/Madrid', '{MAD}', 40.4168, -3.7038, 4, null, null, false, 230, 'EUR'),
  ('BCN', 'Barcelona', 'España', 'europe', 'Europe/Madrid', '{BCN}', 41.3874, 2.1686, 4, null, null, false, 240, 'EUR'),
  ('IBZ', 'Ibiza', 'España', 'europe', 'Europe/Madrid', '{IBZ}', 38.9067, 1.4206, 4, null, null, false, 250, 'EUR'),
  ('TFE', 'Tenerife', 'España', 'europe', 'Atlantic/Canary', '{TFS,TFN}', 28.4636, -16.2518, 5, null, null, false, 260, 'EUR'),
  ('AMS', 'Ámsterdam', 'Países Bajos', 'europe', 'Europe/Amsterdam', '{AMS}', 52.3676, 4.9041, 3, null, null, false, 270, 'EUR'),
  ('BRG', 'Brujas', 'Bélgica', 'europe', 'Europe/Brussels', '{BRU}', 51.2093, 3.2247, 2, null, null, false, 280, 'EUR')
on conflict (code) do nothing;

-- Normas de alquiler temporario (filtro duro con motivo, antes de CP-SAT). Las dos exigen un número de registro que el
-- proveedor no informa: el motor descarta los alquileres y quedan los hoteles, sin importar las noches.
insert into public.city_legal_rules (city_code, rule, value, note, source_url, source_kind, reviewed_on) values
  ('AMS', 'short_term_rental_registration_required', 1,
   'Vakantieverhuur: registro en cada anuncio, permiso, aviso previo de cada estadía, máx. 4 huéspedes y 30 noches/año (15 en partes de Centrum y De Pijp). El proveedor no informa el registro.',
   'https://www.amsterdam.nl/wonen-bouwen-verbouwen/huisvestingsvergunning/regels-voor-vakantieverhuur/', 'official', '2026-11-13'),
  ('BRG', 'short_term_rental_registration_required', 1,
   'Logiesdecreet de Flandes: todo alojamiento alquilado a turistas, aunque sea ocasional, se registra en Toerisme Vlaanderen y recibe un número. El proveedor no lo informa.',
   'https://toerismevlaanderen.be/nl/logies/aanmelding', 'official', '2026-11-13')
on conflict (city_code, rule) do nothing;
