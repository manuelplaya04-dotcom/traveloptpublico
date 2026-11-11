# Fase 6: cierre de la Fase 1 de producto y escalabilidad a costo cero

**Objetivo:** dejar la versión publicada "lista para producción" (deuda técnica cerrada) y sumar transporte multimodal,
estimación de traslados urbanos, alojamientos con comodidades obligatorias y un catálogo de actividades real, **sin
costo de infraestructura**.
**Requisito previo:** producción publicada (Fase 5) y `GATE FASE 5: OK`.
**Regla de la fase:** cada fuente nueva entra como un proveedor más del motor (patrón Adapter). El optimizador no se
toca: n8n programa la ingesta, Python normaliza con Pydantic, Supabase guarda, y la interfaz muestra siempre el
origen del dato ("estimado", "simulado", licencia).

Leyenda: 🤖 lo hace Claude de punta a punta (código, migración local, tests). 👤 necesita una acción tuya (cuenta, clave
de API, descarga o aprobación). Todo cambio a producción (`db push`, push a `main`) sigue requiriendo tu OK.

---

## 6.0 Diagnóstico de cierre (2026-11-01)

| Área | Estado | Hueco |
|---|---|---|
| OWASP: RLS, cuotas, SSRF, links | ✅ | — |
| CSP | ⚠️ | `script-src 'unsafe-inline'`: no frena scripts inyectados en línea |
| Error Trigger / observabilidad | ◐ | Sin n8n en prod; los errores del navegador solo llegan a la consola |
| DRY | ◐ | Catálogo de ciudades en la web y copiado en tests del motor; tabla de imperdibles medida a mano; `case_key` fijo en cada pedido |
| Server Components | ◐ | Planificador cliente por diseño (aceptado) |

Deuda funcional detectada: clic en "Armamos tu viaje" antes de hidratar no hace nada; re-optimizar con muchas
actividades puede dar "sin opciones" sin aviso previo; el simulador ignora husos horarios; "1 baño" estimado no se
aclara; el hero pide 8 tiles por ciudad al servidor público de OpenStreetMap; no hay auditoría automática de
accesibilidad.

---

## 6.1 Cierre de deuda (Fase 1 lista para producción)

| # | Tarea | Quién | Hecho cuando |
|---|---|---|---|
| 1 | CSP con nonce por request (sin `'unsafe-inline'` en scripts) | 👤 decisión, luego 🤖 | En Next.js el nonce obliga a renderizar **todas** las páginas por request (la landing deja de ser estática y aumenta el uso de funciones). Alternativa: mantener CSP actual + Trusted Types. Decidir antes de implementar |
| 2 | CTA sin efecto antes de hidratar → botón con estado de carga hasta que React está listo | 🤖 | E2E sin reintento en `openForm` |
| 3 | Aviso antes de re-optimizar actividades si no entran en los días | 🤖 | Test unitario de capacidad + aviso visible |
| 4 | "Estimado" visible en baños inferidos (tooltip) | 🤖 | Texto accesible en la tarjeta |
| 5 | Husos horarios en el simulador (zona por ciudad) | 🤖 | Vuelos con horas locales coherentes; golden intacto |
| 6 | Proxy con caché para tiles del hero (`/api/tiles`, caché de CDN de 7 días) | 🤖 | El navegador ya no pega directo a `tile.openstreetmap.org` desde el hero |
| 7 | `axe-core` en los E2E (0 violaciones serias) | 🤖 | Test de accesibilidad en landing, formulario y resultado |
| 8 | Errores del navegador a Supabase (`client_errors`, con límite por usuario y retención de 30 días) | 🤖 local · 👤 OK para `db push` | `error.tsx` reporta; pgTAP de RLS |
| 9 | Catálogo de ciudades en la base (`cities`) y capacidad de imperdibles calculada por el motor | 🤖 local · 👤 OK para `db push` | Web y tests leen de una sola fuente; sin tablas a mano |
| 10 | Desacoplar `case_key` (el motor detecta su caso de prueba) | 🤖 | La web no manda `orlando_nyc_5pax` |
| 11 | Pendientes de la Fase 5: rollback en Vercel, 2FA en Vercel/UptimeRobot, PR de Dependabot (mypy) | 👤 | Checklist de `docs/guia_deploy.md` al día |

## 6.1b Experiencia: transiciones, impresión y contexto espacial

| # | Tarea | Quién | Hecho cuando |
|---|---|---|---|
| 12 | **Transiciones sin saltos (CLS):** skeleton con la misma estructura que el resultado, entrada con `transition-opacity duration-300 ease-in-out` (CSS, sin librerías), alturas reservadas para mapa e imágenes | 🤖 | CLS < 0.1 medido con PerformanceObserver en el flujo Optimizar → resultado |
| 13 | **Impresión / PDF:** `@media print` con modificadores `print:` — se ocultan botones, navegación, panel flotante y modales; fondo blanco y texto negro forzados; A4 con márgenes; `break-inside-avoid` en días, tarjetas y actividades; todos los pasos visibles en papel; links con su URL impresa | 🤖 | Vista de impresión limpia en Chromium (`page.pdf`) sin cortes de tarjetas; botón "Imprimir / PDF" |
| 14 | **Ubicación y distancias:** coordenadas (opcionales) en alojamientos y actividades del contrato; el simulador las genera alrededor del centro y el fixture trae las reales aproximadas; el mapa de la ciudad marca el alojamiento elegido y las actividades; cada día muestra la distancia en línea recta y un tiempo estimado desde el alojamiento | 🤖 | Marcadores en el mapa; distancia por actividad en el calendario; rotulado "estimado" |
| 15 | **Miniaturas:** placeholder por tipo en alojamientos y actividades con proporción fija (sin CLS); fotos reales con licencia en 6.3 (Wikidata/Commons) | 🤖 | Tarjetas con miniatura y alto reservado |

Carga optimizada: mapa e impresión no suman JS a la carga inicial (el mapa sigue en `next/dynamic` sin SSR; la
impresión es solo CSS).

## 6.2 Alojamiento con comodidades obligatorias

- **Esquema:** `properties` (ubicación, tipo, fuente, licencia), `units` (capacidad, dormitorios, baños, camas),
  `amenities` (catálogo cerrado: cocina completa, lavarropas, estacionamiento, ascensor, accesible…),
  `property_amenities` (N–N) y `rates` (precio por fecha, aparte).
- **Filtro O(1):** máscara de bits de comodidades por propiedad; "tiene todas las obligatorias" es
  `(mascara & requeridas) == requeridas`, indexable en Postgres.
- **Contrato:** `Constraints.required_amenities`; descarte con motivo `lodging.missing_amenity:<código>` en el embudo y
  en los consejos.
- **Interfaz:** chips "Imprescindible" en el paso 3 (🍳 cocina, 🧺 lavarropas, 🅿️ estacionamiento).
- **Datos:** 🤖 el simulador genera comodidades coherentes. 👤 Inside Airbnb (CC BY 4.0, tiene comodidades y precios
  de Nueva York, Boston, Chicago y Washington; cobertura de Orlando y Miami a verificar): necesita tu OK para
  descargar los datasets.

## 6.3 Catálogo dinámico de actividades

- **Fuentes sin clave (🤖):** OpenStreetMap vía Overpass (museos, atracciones, miradores, parques, horarios), Wikidata
  (descripción, popularidad, fotos de Wikimedia Commons con licencia: también resuelve las fotos del hero),
  Wikivoyage (CC BY-SA).
- **Fuentes con clave gratuita (👤):** NPS API (parques nacionales) y Ticketmaster Discovery (eventos con fecha).
- **Flujo en n8n:** disparador semanal por ciudad → pedidos en paralelo → `/ingest/activities` (Pydantic) → dedupe por
  QID de Wikidata u OSM id → inferencia de duración, aire libre y rango de precio → tabla `activities` con fuente y
  licencia → Error Trigger si falla.
- **Seguridad:** cada host nuevo entra a la lista blanca de salida (`EGRESS_ALLOWLIST`); APIs y descargas antes que
  scraping; si se scrapea: `robots.txt`, ritmo limitado y User-Agent identificado.

## 6.4 Transporte entre ciudades multimodal

- **Modelo:** el tramo pasa de "vuelo" a `TransportLeg` con modo (avión, tren, bus, auto), duración puerta a puerta y
  costo; nuevas restricciones (horas máximas de viaje, valijas).
- **Horarios (🤖 con tu OK para descargar):** GTFS públicos de Amtrak y de FlixBus/Greyhound, filtrados a las 8
  ciudades e indexados ruta + fecha → salidas. Con directos y un transbordo alcanza para la costa este.
- **Tarifas:** GTFS no trae precios → modelo paramétrico (distancia, anticipación, día), rotulado "estimado", con link
  a la empresa.
- **Auto:** días × tarifa por ciudad + recargo por devolución en otra ciudad + combustible (distancia ÷ consumo ×
  precio de nafta) + peajes estimados. 👤 clave gratuita de OpenRouteService (distancias) y de EIA (precio de nafta).
- **Vuelos internos:** el simulador actual; 👤 Amadeus Self-Service si su cuota gratuita alcanza (verificar
  condiciones vigentes).
- **Interfaz:** chips de modo por tramo (✈️ 🚆 🚌 🚗) y comparación tiempo/costo con línea de tiempo.

## 6.5 Uber/Lyft estimado

`tarifa = (base + por_milla × distancia + por_minuto × duración + cargo_reserva) × demanda(mes, día, hora) × ajuste_IPC`

- Distancia y duración: OpenRouteService (👤 clave gratis), cacheadas en `api_cache`.
- Tarifas base: tabla por ciudad actualizada a mano cada trimestre con precios publicados (🤖 la estructura;
  sin scraping de las apps).
- Inflación: IPC de la API del BLS (la versión sin clave alcanza para una serie mensual).
- Demanda: multiplicadores por hora, día y mes.
- Salida: rango p10–p90 rotulado "estimado"; el motor optimiza con el valor medio.

---

## Orden de trabajo

1. **6.1 y 6.1b** (cierre de deuda y experiencia): pasos 2 a 15 sin depender de nada externo; el 1 espera tu decisión.
2. **6.2** alojamiento con comodidades (simulado primero; Inside Airbnb con tu OK).
3. **6.3** actividades desde OSM + Wikidata (sin claves), después NPS y Ticketmaster.
4. **6.4** transporte multimodal (GTFS con tu OK; claves para auto).
5. **6.5** estimación de Uber/Lyft.

**Riesgo transversal:** las cuotas gratuitas cambian. Cada proveedor degrada con elegancia y rotula el dato como
"estimado" si se agota la cuota, como ya hace el clima.

## Checks del gate

| Check | Criterio |
|---|---|
| CP-6.1 | CSP: decisión registrada (nonce con render dinámico, o CSP actual + Trusted Types) |
| CP-6.1b | CLS < 0.1 en Optimizar → resultado; impresión A4 sin cortes; mapa con marcadores y distancias |
| CP-6.2 | 0 violaciones serias de `axe-core` en landing, formulario y resultado |
| CP-6.3 | Catálogo de ciudades con una sola fuente de verdad |
| CP-6.4 | Filtro de comodidades obligatorias con motivo en el embudo |
| CP-6.5 | Ingesta de actividades idempotente (dos corridas = mismos registros) y con licencia por fila |
| CP-6.6 | Todo dato estimado o simulado rotulado en la interfaz |
| CP-6.7 | Golden intacto (USD 20,083.62) |

## Avance

| Fecha | Hecho | Pendiente |
|---|---|---|
| 2026-11-01 | 6.1: 2 (CTA hasta hidratar), 3 (aviso de actividades), 4 (baños estimados), 5 (husos horarios + `tzdata`), 6 (`/api/tiles` con caché de CDN; CSP `img-src 'self'`), 7 (axe-core: 0 violaciones serias), 8 (`client_errors`: migración, RLS sin políticas, endpoint del motor con límite, retención 30 días, pgTAP), 10 (sin `case_key` en la web). 6.1b: 12 (CLS 0.218 → 0), 13 (impresión A4), 14 (mapa y distancias), 15 (miniaturas) | 1 (decisión CSP), 8 en producción (`db push`, con tu OK), 9 (catálogo en la base), 11 (tus pendientes de la Fase 5), 6.2 a 6.5 |
| 2026-11-02 | V1 costa este: deportes (equipos y estadios reales, calendario simulado por temporada), ORL/NYC con datos del fixture + simulados, links a Expedia y Airbnb, tipos y espacio de "Momento óptimo de compra", carrito en `sessionStorage`, informe `docs/compliance_v1.md` | Decisiones: Chicago en V1, cookie de sesión persistente, CSP con nonce |
| 2026-11-02 | Paso 1 (CSP con nonce, sin `unsafe-inline` en scripts), sesión temporal, deportes solo estáticos, sin Chicago, sello "Dato de ejemplo" | 8 en producción ya aplicado; 9, 11, 6.2 a 6.5 |

Nota operativa: dos `next dev` sobre la misma carpeta `.next` se pisan y recompilan en bucle; antes de reiniciar el
servidor de desarrollo, verificar que no quede otro proceso de Next corriendo.
