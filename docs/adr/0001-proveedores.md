# ADR 0001: proveedores de datos live

- **Estado:** aceptado para **vuelos** (SerpApi Google Flights) y **alojamiento** (SerpApi Google Hotels); resto de las
  categorías: fixture hasta decidir
- **Fecha:** 2026-10-26 · actualizado 2026-11-03 (Fase 2, paso 2)
- **Contexto de origen:** `fase_1_extraccion.md` §1.9

## Regla de la Fase 2 (2026-11-02)

Todo proveedor debe ser **gratuito y sin tarjeta** para registrarse, probar y usar su plan gratuito. Si exige vincular
un medio de pago, se descarta. Las peticiones a terceros salen **solo del motor** (Render): el navegador nunca habla
con un proveedor (sin filtrar la IP del usuario, CSP `connect-src` sin cambios) y las claves viven solo en variables de
entorno del motor.

## Vuelos: evaluación (2026-11-02)

| Candidato | Gratis sin tarjeta | Datos reales | Veredicto |
|---|---|---|---|
| **SerpApi Google Flights** | ✅ plan gratuito, 250 búsquedas/mes y 50/hora; según comparativas de 2026 el alta no pide tarjeta (verificar al crear la cuenta) | ✅ precios de Google Flights en el momento | **Elegido** |
| Travelpayouts Data API (Aviasales) | ✅ token gratuito de afiliado | ◐ caché de búsquedas de terceros (hasta ~48 h), sin garantía de fecha exacta | Alternativa / respaldo |
| Duffel | ✅ modo test sin tarjeta | ❌ en test solo responde una aerolínea sintética; live cobra por búsqueda u orden | Descartado |
| Amadeus Self-Service | — | — | Cerrado el 17/07/2026 (solo Enterprise con contrato) |
| Kiwi Tequila | — | — | Solo por invitación desde 2024 |
| Scraping propio con proxies rotativos gratuitos | ✅ | ✅ | **Rechazado**: los términos de Google y de las aerolíneas lo prohíben, implica evadir anti-bots y CAPTCHAs, y un proxy gratuito ve y puede alterar el tráfico (riesgo de MITM incompatible con ISO 27001) |

**Riesgos aceptados de SerpApi:** el plan gratuito no incluye la cobertura legal ("U.S. Legal Shield") de los planes
pagos y los datos derivan de Google: antes de uso comercial pasa por la revisión legal ya registrada (decisión 3). La
cuota es chica: la caché compartida (tabla `api_cache`, TTL de 30 min para vuelos) y el tope de búsquedas por corrida
(`MAX_FLIGHT_QUERIES_PER_RUN`, 12; el caso golden necesita 9) son obligatorios.

**Contrato del adapter** (`engine/app/providers/flights.py`):

- Una búsqueda por consulta del plan (solo ida, una fecha, aeropuertos separados por coma), con `adults=1`. El precio
  es por pasajero sin ambigüedad y la clave de caché no depende del grupo: búsquedas iguales de distintos usuarios
  comparten la consulta.
- Montos en USD enteros → centavos (`int`). Horarios locales del aeropuerto (ISO 8601, sin zona), igual que el modelo.
- Escalas = cantidad de `layovers`. Aerolínea = código IATA del primer tramo.
- **Limitaciones:** Google Flights no informa asientos libres (se usa 9, la convención de los GDS) ni la franquicia de
  valijas despachadas (0 y sin cargo; la tarifa final se ve en el link). Si un viaje exige valijas, el costo de
  vuelos puede quedar subestimado hasta sumar una fuente de equipaje.
- Errores: "sin resultados" es una lista vacía (se cachea). Cualquier otro error falla la consulta y **no** se
  cachea. 429 y 5xx usan reintentos con backoff exponencial y `Retry-After`, y el circuit breaker por proveedor.
- Activación: con `SERPAPI_API_KEY` cargada, el modo `hybrid` usa vuelos reales y el resto de ejemplo; `live` expone
  vuelos, alojamiento y clima. `fixture` no cambia (el caso golden queda intacto). La web no cambia: el sello "Dato de ejemplo"
  desaparece solo en las ofertas de este proveedor.

## Alojamiento: SerpApi Google Hotels (2026-11-03)

Misma cuenta, misma clave y **misma cuota** que los vuelos (250 búsquedas/mes, 50/hora para toda la cuenta: un solo
limitador para ambos). Respuestas reales grabadas como contrato en `engine/tests/contracts/serpapi_google_hotels_nyc.json`.

**Contrato del adapter** (`engine/app/providers/hotels.py`):

- Por estadía, una búsqueda de hoteles con `adults=2` (precio de una habitación estándar; la clave de caché no depende
  del grupo) y, si el grupo es de 3 o más, una de alquileres temporarios con `adults=pax`. Solo la primera página.
- Precio: `total_rate` (estadía completa). Base = antes de impuestos; impuestos y cargos = final − base, como cargo de
  la unidad. El total cotizado concilia al centavo. Estrellas (`extracted_hotel_class`), puntuación (×2, escala 0–10),
  coordenadas y comodidades (hasta 12) como las informa Google.
- **Baños (sin inventar):** habitación de hotel = 1 baño privado (`inferred_per_room`, como ya hacían el fixture y el
  simulador; 2 habitaciones = 2 baños, así la regla de baños mínimos sigue siendo una sola y el golden no se mueve).
  Alquiler: el dato de `essential_info`; si no lo trae, se cuenta el mínimo cierto, 1 (`inferred_minimum`), y la
  regla lo descarta si se piden 2 o más.
- **Cupo:** Google no informa cuántas habitaciones quedan. Se ofrecen las que el grupo necesita (de a 2) y se confirma
  al reservar, como los asientos de un vuelo. La web no muestra "Últimos lugares" para este proveedor.
- **Legalidad:** NYC y Brooklyn (Local Law 18) prohíben alquilar una vivienda completa por menos de 30 noches: esos
  alquileres se marcan no legales y el embudo los descarta con motivo. En otras ciudades no hay una regla verificada:
  se toma el anuncio como publicado legalmente (limitación a revisar con la revisión legal).
- Tope por corrida: `MAX_LODGING_QUERIES_PER_RUN` (8). Caché de 24 h: las tarifas de hotel se mueven por día.

## Cuota compartida y modo histórico (2026-11-03)

`engine/app/services/serpapi.py` centraliza las búsquedas de SerpApi:

1. **Caché primero** por parámetros (sin la clave): vuelos 30 min, alojamiento 24 h. Un acierto no gasta cuota.
2. **Medidor de cuota:** lee `account.json` (no consume búsquedas) cada 10 min y descuenta cada búsqueda hecha. Un
   rechazo de SerpApi por cuota lo pone en 0 al instante. `SERPAPI_QUOTA_RESERVE` deja un margen sin usar.
3. **Modo histórico:** con la cuota agotada, se sirve la última respuesta real guardada aunque esté vencida (la caché
   conserva lo vencido hasta la retención de 30 días). La corrida queda marcada `summary.degraded[kind] =
   "quota_historical"` y la web lo avisa; cada tarjeta muestra cuándo se cotizó (`fetched_at`).
4. **Sin datos guardados:** error controlado `quota_exhausted`; la corrida falla con ese código y la web pide
   flexibilizar fechas o intentar más tarde. Nunca se inventa un precio.

## Presupuesto por consulta y caos (2026-11-03)

- **Por qué se gastaba tanto:** Google Flights y Google Hotels cotizan una fecha (o un par de fechas) por búsqueda; no
  hay rangos. La ida se busca en 2 fechas (el día y la noche anterior), multiplicado por los días de flexibilidad, y
  cada estadía suma 1 búsqueda (2 con alquileres para grupos): hasta ~17 por consulta.
- **Presupuesto:** `MAX_SERPAPI_QUERIES_PER_RUN` = 6 búsquedas **pagas** (lo que está fresco en caché no cuenta). Si el
  plan no entra, se acota en orden: sin flexibilidad → sin salir la noche anterior → solo hoteles
  (`engine/app/services/quota_plan.py`). Queda en `summary.quota_narrowed` y la web lo explica. Extracción y optimizador
  usan la misma solicitud acotada; las restricciones duras no cambian.
- **Reserva:** `SERPAPI_QUOTA_RESERVE` = 20. Con 20 o menos búsquedas restantes el medidor actúa como circuit breaker
  de cuota: modo histórico (precios guardados) o `quota_exhausted`.
- **Falla parcial:** si una búsqueda falla tras reintentos (500, timeout, circuito abierto), se usa su último dato real
  guardado; si no hay, la corrida sigue con las que respondieron (`summary.degraded[kind] = "partial_upstream"`, aviso
  en la web). Solo si fallan todas la categoría falla. Un error de programación nunca se trata como falla parcial.
- **Carrera en caché:** pedidos idénticos simultáneos comparten una sola llamada (coalescencia en proceso, `_inflight`
  en `cache.py`). Alcanza porque el motor corre en una sola instancia; con varias réplicas haría falta un lock
  distribuido (`pg_advisory_xact_lock` por clave de caché).

## Release: pesos, fotos, eventos (2026-11-03)

- **Pesos argentinos:** dolarapi.com (sin clave). La web lo consulta del lado del servidor (`/api/fx`, host fijo,
  respuesta validada con zod, caché de 30 min) y muestra el total al dólar tarjeta y al MEP ("bolsa"). Es una
  referencia: el total que concilia al centavo sigue en USD. Si falla, la sección no aparece.
- **Fotos de alojamiento:** la primera miniatura de Google Hotels (`photo_url`, solo `lh3–6.googleusercontent.com`),
  servida por el proxy propio `/api/photo` (sin redirecciones, solo imagen, máx. 2 MB, caché de CDN): el navegador
  no le habla a Google y la CSP no cambia. 0 búsquedas extra: ya venía en la respuesta.
- **Eventos:** Ticketmaster Discovery API (clave gratis sin tarjeta, cuota propia; en vivo con caché de 6 h) + Google
  Events pre-cargado por un cron semanal de GitHub Actions (`prefetch-events.yml`, 1 búsqueda de SerpApi por ciudad,
  ~9/mes, respeta la reserva). Las búsquedas de los usuarios nunca consultan Google Events: leen la caché. Cada
  fuente falla sola; sin eventos la sección no aparece. No entran al optimizador ni al total.

## Major release: logística, lugares, valijas (2026-11-03)

- **Rutas por calle:** OSRM público (OpenStreetMap, sin clave): alojamiento → aeropuertos y actividades, en auto.
  Caché **permanente** (la red de calles casi no cambia), 1 pedido por segundo y User-Agent identificado (política
  del servidor). Si no responde, la web usa su estimación en línea recta, marcada "(estimado)". Sin precios de taxi.
- **Lugares reales:** Wikidata (SPARQL, sin clave), 30 días de caché y el último resultado si Wikidata cae. No hay
  precios de entrada en fuentes gratuitas, así que **no entran al optimizador**: se muestran como información. Las
  actividades con precio que optimiza el motor siguen siendo de ejemplo (con sello) hasta tener una fuente real de
  precios; reemplazarlas por lugares sin precio obligaría a inventar montos. Google Maps (SerpApi) **no** se usa como
  respaldo: gastaría cuota y Wikidata con caché alcanza.
- **Valijas:** tabla estática `engine/app/data/bag_fees.json` (fuente y fecha: FrequentMiler, 2026-04-09, coincide
  con Lugless; las páginas oficiales bloquean la lectura automática). Solo vuelos dentro de EE.UU. y 1–2 valijas;
  internacional o 3+ valijas: `bag_fee_known=false` y la web avisa que no está sumado. Revisar cada 6 meses.
- **Ticketmaster sin clave:** el módulo queda apagado (`not_configured`), sin errores.

## Release final de Fase 1: sin datos simulados en producción (2026-11-04)

- **Actividades:** `engine/app/data/curated_activities_pricing.json` (15 atracciones con precio publicado, fuente y
  fecha; validado con Pydantic). Disney y Universal cobran por fecha: se usa el mínimo publicado y la web dice "desde".
  Se pidieron 20–30: solo entraron las verificables; Broadway, Circle Line, AMNH, Medieval Times y The Wheel tenían
  fuentes contradictorias o sin fecha y quedan como "entrada sujeta a taquilla" (costo 0, no sumado, aclarado en la web).
  Lugares de Wikidata fuera de la lista: igual, "Paseo público / entrada sujeta a taquilla".
- **Traslados:** en hybrid con clave no se cotizan (no hay precios gratuitos); la web muestra la logística real (OSRM).
- **Resultado:** con `SERPAPI_API_KEY` en hybrid, ninguna categoría usa datos simulados y el sello "Dato de ejemplo"
  no aparece. En modo fixture (local, tests, golden) el sello sigue: son datos de prueba a propósito.
- **Asesor de momento óptimo:** `public.flight_price_stats` (percentiles exactos en Postgres, índice por ruta y día:
  2,2 ms con 60.000 ofertas). Cold start: con menos de 3 momentos de cotización no hay etiqueta.
- **Alertas:** webhook asíncrono (Discord/Slack/Telegram), máx. 1 por tipo cada 15 min, contexto en lista blanca.

## Contexto

Amadeus Self-Service cerró el 17/07/2026. El motor ya tiene la interfaz de proveedores (§1.5), el modo `fixture` con el caso `orlando_nyc_5pax` y clima real (Open-Meteo) en modo `hybrid`. Falta elegir un proveedor live por cada categoría restante.

## Decisión

Las categorías sin proveedor live usan **fixture**. En modo `live` responden 501 `provider_not_configured`, como se verificó en CP-1.11.

| Categoría | Proveedor elegido | Modo actual |
|---|---|---|
| Vuelos | SerpApi Google Flights (`serpapi_google_flights`) | `hybrid` / `live` con `SERPAPI_API_KEY` |
| Alojamiento | SerpApi Google Hotels (`serpapi_google_hotels`) | `hybrid` / `live` con `SERPAPI_API_KEY` |
| Actividades | fixture hasta decidir | `fixture` |
| Transporte | fixture hasta decidir | `fixture` |
| Clima | Open-Meteo (climatología + pronóstico) | `hybrid` / `live` |

## Matriz de evaluación (pendiente)

Puntaje de 1 a 5 por criterio. Total = Σ (puntaje × peso).

| Criterio | Peso |
|---|---|
| Alta self-service o plazo de aprobación | 20 % |
| Cobertura de las rutas EZE–MCO–NYC y de alquileres en Orlando | 20 % |
| Atributos requeridos (baños y dormitorios en alojamiento; valijas en vuelos) | 20 % |
| Costo por búsqueda o reserva y política de *look-to-book* | 15 % |
| Rate limits documentados | 10 % |
| Términos de uso (scraping, deeplinks, afiliación) | 15 % |

| Categoría | Candidato | Alta (20) | Cobertura (20) | Atributos (20) | Costo (15) | Rate limits (10) | Términos (15) | Total |
|---|---|---|---|---|---|---|---|---|
| Vuelos | Duffel | | | | | | | |
| Vuelos | SerpApi Google Flights | | | | | | | |
| Vuelos | Amadeus Enterprise / toolkit con Anthropic | | | | | | | |
| Alojamiento | LiteAPI | | | | | | | |
| Alojamiento | SerpApi Google Hotels (`vacation_rentals`) | | | | | | | |
| Actividades | Viator Partner API | | | | | | | |
| Actividades | Tabla curada de parques | | | | | | | |

## Consecuencias

- El MVP sigue funcionando de punta a punta con datos fixture y clima real.
- Cada adapter nuevo implementa la interfaz de §1.5, agrega su entrada en `LIMITERS` (`engine/app/services/http.py`) y `TTL_S` (`engine/app/services/cache.py`) y se registra en `engine/app/providers/registry.py` para el modo `live`.
- CP-1.13 queda abierto ("fixture hasta decidir") hasta que se complete la matriz.
