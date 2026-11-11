# TravelOpt: directivas core del proyecto

**Obligatorias para todo el ciclo de vida del software.** Antes de escribir, generar o modificar cualquier script, nodo o
componente de interfaz, el cambio se verifica contra este documento. `CLAUDE.md` lo declara de lectura obligatoria.

Si una directiva entra en conflicto con un invariante del dominio de `CLAUDE.md` (dinero en centavos, determinismo,
restricciones duras con motivo registrado, golden), **gana el invariante** y la tensión se resuelve con una decisión
explícita registrada abajo, nunca en silencio.

---

## Normativas (texto literal)

### 1. SEGURIDAD Y ARQUITECTURA (OWASP)
Aplica estrictamente los estándares del OWASP API Security Top 10 (2023). Implementa mitigaciones contra BOLA (Broken Object Level Authorization) y BOPLA configurando políticas estrictas de Row Level Security (RLS) en la base de datos SQL (Supabase) para garantizar que un usuario solo acceda y modifique sus propios registros. Previene el consumo ilimitado de recursos ('Unrestricted Resource Consumption') configurando cuotas, paginación y Rate Limiting estricto en los webhooks de n8n y scripts de Python. Para el frontend en Next.js, neutraliza ataques XSS (Cross-Site Scripting) sanitizando los inputs y estableciendo una política Content Security Policy (CSP). Finalmente, bloquea intentos de SSRF (Server Side Request Forgery) validando por lista blanca cualquier URL antes de que el servidor consuma APIs externas.

### 2. BUENAS PRÁCTICAS Y CLEAN CODE
Tu objetivo es escribir código mantenible aplicando estrictamente los principios SOLID y DRY. En el entorno Next.js/React, separa la lógica de negocio de la vista utilizando Custom Hooks y prioriza el uso de React Server Components para reducir el JavaScript enviado al cliente. En Python, aplica tipado estático riguroso (Type Hints) y utiliza librerías como Pydantic para la validación exacta de las estructuras JSON de entrada y salida. En la orquestación visual (n8n), implementa manejo de errores global mediante nodos 'Error Trigger' y asegura que ninguna credencial quede hardcodeada, exigiendo el uso exclusivo de variables de entorno. Evita bloques genéricos de excepciones en el backend; captura siempre errores específicos.

### 3. OPTIMIZACIÓN DE RENDIMIENTO Y ALGORITMOS
Tu prioridad absoluta es minimizar la complejidad algorítmica (Big O) y reducir la latencia de red. Optimiza el motor de procesamiento en Python evitando bucles anidados (O(N^2)); utiliza diccionarios (Hash Maps) para búsquedas en tiempo constante (O(1)) al cruzar datos masivos de vuelos y hoteles. En la base de datos, exige la creación de índices SQL en las columnas de mayor filtrado (fechas, ID de destino) e implementa consultas cacheadas para el historial de clima. En el frontend de Next.js, aplica 'Lazy Loading' (carga diferida) en componentes pesados y optimiza las peticiones a APIs ejecutando llamadas concurrentes con Promise.all() en JavaScript o asyncio.gather() en Python, nunca de forma secuencial.

### 4. RESILIENCIA Y TOLERANCIA A FALLOS
Dado que el orquestador depende de múltiples APIs externas, implementa patrones de 'Circuit Breaker' y 'Exponential Backoff' para gestionar tiempos de espera (Timeouts) y reintentos. Si una API no crítica (ej. clima o actividades) falla o demora más de 4 segundos, el sistema debe aplicar degradación elegante (Graceful Degradation): capturar el error de forma aislada, devolver los datos parciales (ej. vuelos y hoteles) y no quebrar la ejecución global del flujo ni la experiencia del usuario.

---

## Interpretaciones para TravelOpt

- **Credenciales en n8n (norma 2).** El objetivo es que ninguna credencial quede hardcodeada. En n8n se cumple con el
  **almacén de credenciales cifrado** (`N8N_ENCRYPTION_KEY`) y con los nodos **sin acceso a `$env`**
  (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`). Así un nodo no puede leer todos los secretos del proceso. Las variables de
  entorno son exclusivas para configurar los servicios (motor, n8n, Vercel). La URL del motor no es una credencial: se
  inyecta por entorno al generar los workflows (`scripts/n8n_render.py`).
- **`except Exception` (norma 2).** Se permite solo en un borde que **registra y vuelve a lanzar** la excepción
  (middleware de tamaño de body, marcar la corrida como `failed` si falla el optimizador, propagar el error a quienes
  esperan el mismo dato en el caché), o en la raíz de una **tarea de fondo** que nadie espera (orquestación en proceso,
  reaper): ahí se registra con traza y se deja el estado consistente (corrida `failed`), porque relanzar se perdería.
  Nunca para tragarse un error.
- **Degradación elegante vs. restricciones duras (norma 4 vs. `CLAUDE.md`).** Si el clima falla, las actividades al aire
  libre no se pueden validar contra lluvia y calor. Degradar está permitido, pero **con motivo registrado** en el embudo
  y visible en la interfaz. Nunca se relaja la restricción en silencio. La política exacta está **pendiente de decisión**
  (ver abajo).

---

## Estado de cumplimiento (revisión 2026-10-28)

✅ cumple · ◐ parcial · ☐ pendiente

| Norma | Punto | Estado | Evidencia o hueco |
|---|---|---|---|
| 1 | BOLA/BOPLA con RLS | ✅ | RLS por `auth.uid()`, sin escritura desde el navegador, pgTAP 10/10 |
| 1 | Cuotas y rate limit | ✅ | Corridas por usuario, por conexión (IP seudonimizada, decisión 17) y global (Postgres), clima 30/h, n8n con concurrencia, timeout y payload acotados, PostgREST `max_rows` |
| 1 | XSS y CSP | ✅ | React escapa, `safeHref` único en `web/lib/links.ts` (solo https, sin credenciales, sin dominios reservados de relleno; con tests), CSP con nonce por request y `strict-dynamic`, sin `unsafe-inline` en scripts (decisión 9) |
| 1 | SSRF con lista blanca | ✅ | `check_egress` en el cliente HTTP del motor, sin redirecciones, URL del motor validada en n8n |
| 2 | Pydantic en entrada y salida | ✅ | Modelo canónico, `extra="forbid"` en `/v1/runs`. `CityPlan.name` con patrón de solo letras (sin marcado), espejado en zod |
| 2 | Tipado estático riguroso | ✅ | `mypy` (con plugin de Pydantic y `check_untyped_defs`) sin errores, en el CI y en el gate 3 |
| 2 | Error Trigger global en n8n | ◐ | WF-02 existe; falta la notificación real (necesita la cuenta de email del proyecto, en el deploy). En producción sin n8n: errores de render del navegador a `client_errors` vía el motor (límite por usuario, retención 30 días) |
| 2 | Sin credenciales hardcodeadas | ✅ | Almacén de credenciales de n8n, gitleaks en el CI, gate de secretos en el bundle |
| 2 | Excepciones específicas | ✅ | 5 `except Exception`, todos en bordes que registran y relanzan o en la raíz de tareas de fondo (ver interpretaciones) |
| 2 | Errores específicos en el frontend | ✅ | `RunRequestError` con mensajes por código y `runErrorMessage` compartido por los 3 botones que crean corridas; un error inesperado se registra con traza y la persona ve un mensaje genérico, sin detalles internos |
| 2 | Custom Hooks y Server Components | ◐ | Lógica de negocio en `web/lib/` (funciones puras con tests); carga de datos en `web/hooks/` (`useRun`, `useRunData`). Landing y página legal son Server Components; el planner es cliente por diseño (carrito, Realtime) |
| 3 | Hash maps en el motor | ✅ | Revisado: el solver indexa vuelos por (origen, destino, fecha), alojamiento por estadía y actividades por ciudad, y memoiza tramos y estadías compartidos entre esqueletos. Los bucles anidados recorren solo aeropuertos × fechas de un tramo (pocas combinaciones) con búsqueda O(1) |
| 3 | Índices SQL | ✅ | `search_runs (user_id, created_at)`, corridas activas, PK compuestas en ofertas e itinerarios. Revisar al pasar a modo live |
| 3 | Caché del historial de clima | ✅ | `api_cache` por coordenadas, sin vencimiento para el histórico |
| 3 | Lazy loading en el frontend | ✅ | `next/dynamic` en el dashboard por ciudad, el checkout, el detalle del clima y el mapa; la versión de impresión se monta al imprimir. CLS 0 en Optimizar → resultado; accesibilidad auditada con axe-core en los E2E |
| 3 | Re-renders en interacciones de UI | ✅ | Carrusel: el estado de las flechas vive en un subcomponente (scroll pasivo agrupado por frame), la fila no se redibuja. "Ver en mapa": bus fuera de React, solo se redibuja la capa de resaltado del mapa; animación nativa de Leaflet. E2E de integración lista↔mapa (sin requests nuevas, sin tocar la selección, consola limpia) |
| 3 | Llamadas concurrentes | ✅ | `Promise.all` en el planner, `asyncio.gather` en el clima, 5 extracciones en paralelo en n8n |
| 4 | Exponential backoff | ✅ | Reintentos con jitter y respeto de `Retry-After` |
| 4 | Circuit breaker | ✅ | Por proveedor: se abre tras 5 fallas seguidas (red, timeout, 429, 5xx), 30 s de enfriamiento, prueba semiabierta |
| 4 | Timeout de 4 s para APIs no críticas | ✅ | `NONCRITICAL_DEADLINE_S=4` para clima y actividades (extracción y "Ver más"); la consulta sigue en segundo plano y calienta el caché |
| 1 | Cuota de proveedores pagos por uso | ✅ | SerpApi (vuelos y hoteles, 250/mes): caché primero (30 min / 24 h), tope de búsquedas por corrida, limitador de cuenta compartido y medidor de cuota (`account.json`); agotada, modo histórico o error controlado `quota_exhausted` (decisión 10) |
| 1 | SSRF en la web | ✅ | Los fetch del servidor Next van a hosts fijos (tiles OSM, dolarapi.com) o a una lista cerrada de hosts de fotos (`lib/photo.ts`, sin redirecciones, solo imagen, tamaño máximo) |
| 4 | Alertas operativas | ✅ | `app/services/alerts.py`: log JSON + webhook asíncrono (secreto, hosts en lista blanca), throttling de 1 aviso por tipo cada 15 min, contexto sin PII |
| 4 | Degradación elegante | ✅ | Clima o actividades caídos: el motor responde 200, marca `summary.degraded` de forma atómica y el optimizador sigue con vuelos y alojamiento. Advertencias `clima_no_disponible` / `actividades_no_disponibles`, aviso en la interfaz y etiqueta por actividad |

## Decisiones tomadas

1. **Clima caído (2026-10-28):** las actividades al aire libre **se mantienen, marcadas "Clima sin verificar"**
   (`weather_verified: false`), con advertencia en el diagnóstico y aviso en la interfaz. Si fallan las actividades, el
   itinerario sale sin ellas y con aviso. Vuelos y alojamiento siguen siendo críticos: si fallan, la corrida falla.
2. **Producción a costo cero (2026-11-01):** motor en Render Free y **sin n8n en producción**. El motor orquesta en
   proceso (`ORCHESTRATOR=inprocess`) con el mismo flujo y manejo de fallas que WF-01/02/03 (tests en
   `test_orchestrator.py`). Costos aceptados: arranque en frío de ~40 s tras 15 min sin uso (mitigado con `/api/warmup`,
   aviso en la interfaz y UptimeRobot) y sin panel visual de ejecuciones (los logs del motor lo reemplazan). n8n sigue
   en local y se reincorpora con `ORCHESTRATOR=n8n` cuando haya presupuesto.
3. **Privacidad sin datos del responsable (2026-11-01):** el sitio se presenta como herramienta gratuita, sin fines
   comerciales y demostrativa, y no publica nombre ni email del dueño. A cambio, minimiza datos: búsquedas anónimas que
   el motor borra solas a los 30 días (`RETENTION_DAYS`, `purge_older_than`), junto con el registro de uso de APIs y el
   caché vencido. Si el proyecto cobra o se promociona comercialmente, se completa el responsable y revisa un abogado.
4. **Noches por destino (2026-11-01):** el formulario asigna noches exactas a cada ciudad y valida que sumen la duración
   del viaje (antes eran rangos mínimo/máximo). El pedido sale con `min_nights = max_nights`, así que el motor ya no
   explora repartos alternativos. Los valores por defecto usan el reparto del óptimo golden (Orlando 8 + Nueva York 4):
   el óptimo sigue siendo USD 20,083.62 (verificado también con 3 baños: USD 21,636.38). `demo-case.json` sigue siendo
   copia exacta del fixture del motor. Todas las ciudades del catálogo se pueden elegir (hasta 4, tope del contrato);
   las que no tienen datos de demo terminan en "sin opciones" con el motivo en el embudo.
5. **Demo reactiva con datos simulados en el motor (2026-11-01):** se pidió una función `mockFetchResultados` en el
   frontend que inventara resultados según el formulario. **No se hizo así**: el endpoint real (motor) ya está
   conectado, y un mock en el navegador saltearía al optimizador y mostraría totales que no concilian al centavo
   (invariante de dinero) ni respetan las restricciones duras. En su lugar, el motor tiene un proveedor más
   (`app/providers/synthetic.py`, patrón Adapter) que genera vuelos, alojamiento, actividades, clima y traslados para
   cualquier ciudad y fecha, en función de distancias reales, noches, viajeros y estación; determinístico (semilla
   SHA-256 por clave). El fixture se sigue usando para su caso exacto (golden intacto) y para los datos de Orlando y
   Nueva York en otras combinaciones. Los datos se marcan `provider="simulado"` y la interfaz avisa que son de ejemplo.
6. **Fechas vinculadas (2026-11-01):** el formulario guarda ida y duración; la vuelta se deriva (ida + noches) y no
   puede quedar incongruente. Elegir la vuelta recalcula las noches y ajusta la última ciudad. La ida no acepta el
   pasado ni más de 2 años adelante; la vuelta, solo de 1 a 60 noches después de la ida. La "ventana de primera
   noche" del motor se expone como "flexibilidad de ida" (0 a 3 días; el golden usa 1).
7. **Señales de precio sin inventar datos (2026-11-01):** se pidieron precios alternativos por plataforma, "historial de
   precios" y etiquetas de urgencia. Para no mostrar información falsa como si fuera real: las etiquetas salen de la
   propia búsqueda ("Mejor precio" = mínimo del grupo; "En oferta" = ≥ 15% bajo su promedio; "Últimos lugares" =
   asientos o unidades informados por el proveedor), la tendencia compara las fechas consultadas en la corrida (no un
   historial de mercado, que no tenemos) y las plataformas (Skyscanner, Despegar, Aerolíneas, Booking, Google) se ofrecen
   como links de búsqueda para comparar, sin atribuirles precios. Estrellas y puntuación vienen del proveedor; en la
   demo son simuladas y la interfaz lo aclara.
8. **Fase 1 acotada y simulador calibrado (2026-11-01):** el catálogo se limita a 8 ciudades de EE.UU. (Nueva York,
   Orlando, Miami, Filadelfia, Boston, Washington, Chicago, Brooklyn; Brooklyn y Nueva York no se combinan porque
   comparten aeropuertos). Los "sin opciones" venían de imperdibles impuestos por el catálogo que no entraban en las
   noches (Orlando: 5 parques necesitan 8 noches) y del clima plano del fixture (30% de lluvia todos los días). Ahora
   la web pide solo los imperdibles que entran según las noches (tabla medida con el motor) y el simulador se calibra
   al pedido: ≥ 80% de alojamientos con estadía mínima ≤ noches, ≥ 80% de días dentro de la tolerancia de lluvia, el
   catálogo de actividades nunca suma más días que la estadía. Las restricciones duras del motor no se relajan: lo que
   se calibra son los datos de prueba. Garantía cubierta por un fuzz en `test_synthetic.py`. El presupuesto no es
   filtro duro: si no alcanza, se muestra el óptimo con cuánto excede.
9. **V1 costa este, CSP con nonce, sesión temporal y cero datos inventados (2026-11-02):**
   - **CSP:** nonce criptográfico por request en `proxy.ts` (128 bits, `crypto.getRandomValues`) con `'strict-dynamic'`;
     `script-src` sin `'unsafe-inline'`. El nonce es incompatible con el prerenderizado parcial, así que se apagó
     `cacheComponents` y todas las páginas se renderizan por request (`dynamic = "force-dynamic"` en el layout).
     Costo aceptado: la portada ya no se sirve estática desde el CDN. `style-src` conserva `'unsafe-inline'` (atributos
     `style` de React y Leaflet; no ejecutan código).
   - **Sesión:** cookies de Supabase solo de sesión del navegador (`lib/supabase/cookies.ts` quita la expiración que
     `@supabase/ssr` fuerza a 400 días) y `Secure` en HTTPS; el carrito en `sessionStorage`. Al cerrar el navegador la
     sesión desaparece; los datos en la base se borran a los 30 días.
   - **Deportes:** solo información estática real (equipo, liga, estadio) con link a la búsqueda en Ticketmaster; sin
     fechas ni partidos simulados. Todo dato de prueba o simulado lleva el sello "Dato de ejemplo" en su tarjeta.
   - **Alcance:** 7 ciudades de la costa este (se quitó Chicago).
10. **Precios reales con cuota chica (2026-11-03):** vuelos y alojamiento salen de SerpApi (Google Flights y Google
    Hotels) en modo `hybrid`, con una cuota de 250 búsquedas/mes para ambos. Si la cuota se agota, el motor **no
    inventa precios**: sirve la última respuesta real guardada (modo histórico, aviso en la web y antigüedad en cada
    tarjeta, "Cotizado hace X") o, si no hay, falla con `quota_exhausted` y la web pide flexibilizar fechas. Se pidió
    que la regla de baños mínimos aplicara solo a alquileres: **se mantuvo una sola regla** para no mover el golden;
    una habitación de hotel cuenta 1 baño privado (2 habitaciones = 2 baños) y un alquiler sin el dato cuenta el mínimo
    cierto (1). Detalle en `docs/adr/0001-proveedores.md`.
11. **Major release sin datos inventados (2026-11-03):** se pidió erradicar las actividades de ejemplo con Wikidata.
    Wikidata da lugares reales pero **no precios de entrada**; meterlos al optimizador obligaba a inventar montos (o
    tratarlos como gratis), así que se muestran como "Lugares para conocer" sin sumarse al total, y las actividades
    con precio siguen con su sello "Dato de ejemplo". Rutas por calle reales (OSRM) con caché permanente; tarifas de
    valija publicadas solo donde son fijas (EE.UU., 1–2 valijas). Links de solo lectura: tabla
    `shared_itineraries` que solo escribe y lee el motor (RLS sin políticas, token aleatorio, vence con la búsqueda).
    Panel de cuota con doble llave (`NEXT_PUBLIC_ADMIN_MODE` muestra, `ADMIN_MODE` del servidor habilita la ruta).
12. **Fase 1 cerrada sin datos simulados en producción (2026-11-04):** se pidió que el sello "Dato de ejemplo"
    desapareciera de toda la plataforma. Desaparece donde el dato pasó a ser real (en producción, hybrid con clave:
    vuelos, hoteles, actividades con precio publicado o "entrada sujeta a taquilla", traslados sin cotizar). En modo
    fixture se mantiene, porque esos datos son de prueba y quitarles el sello sería presentarlos como reales. Se
    pidieron 20–30 precios curados: entraron 15, los verificables; el resto se muestra como taquilla en vez de un
    número dudoso.
13. **"Ver en mapa" sin estado de React ni geocodificación (2026-11-04):** las tarjetas avisan al mapa por un bus en
    memoria (`web/lib/mapFocus.ts`), no por un estado global: así un clic no redibuja la lista ni el layout, solo la capa
    de resaltado del mapa de esa ciudad. Desde vuelos, el planificador cambia al paso de la ciudad y el mapa toma el
    pedido al montar (una vez, si tiene menos de 10 s). Las coordenadas salen del payload guardado (alojamiento,
    actividades), de la respuesta ya cargada (lugares, eventos de Ticketmaster) o de tablas estáticas (aeropuertos,
    estadios en `web/lib/mapTargets.ts`); sin coordenadas no hay botón. En Leaflet no se llama a `map.stop()` al
    desmontar: después de `remove()` hace `setZoom` sobre un panel borrado y lanza `_leaflet_pos`.
14. **Línea de tiempo por destino y aviso Beta (2026-11-04):** el calendario del checkout
    (`web/components/checkout/ItineraryTimeline.tsx`) se agrupa **por destino**, no por fecha (región común y
    proximidad de Gestalt, chunking: la persona piensa "los días en Orlando, después Nueva York"). Cada grupo muestra
    check-in, check-out y noches; los días se numeran de punta a punta desde el Día 1. Un día va a la ciudad donde se
    duerme; si se duerme en el avión, a la ciudad que se deja ese día; la salida y el regreso van a "En tránsito".
    Etiquetas a partir de los horarios del vuelo (`web/lib/checkout.ts::dayTags`): llegada ≥ 18:00 = "Día de traslado",
    salida ≥ 19:00 del día de check-out = "Último día aprovechable" y llegada con 2 h o más antes del check-in =
    sugerencia de drop-off. **El alojamiento no informa su horario de check-in**: se usa el habitual (15:00) y el texto
    dice "suele ser", sin presentarlo como dato del hotel. Zero-crash: fechas u horas con formato inválido no generan
    días ni etiquetas, el calendario tiene un tope de 120 días y sin fechas muestra un aviso. El selector de destinos
    muestra el alcance de la beta (Costa Este de EE. UU., lista tomada del catálogo) y el buscador ya no sugiere
    ejemplos fuera del catálogo.
15. **Cocina con tres estados y ayudas ⓘ accesibles (2026-11-04):** se pidió un badge "Cocina incluida" y un filtro para
    exigirla. Google Hotels (SerpApi) **no lo informa de forma pareja**: en la respuesta real grabada
    (`engine/tests/contracts/serpapi_google_hotels_nyc.json`) los 10 alquileres temporarios listan "Kitchen" y los 6
    hoteles traen solo un resumen de 6 a 12 comodidades, sin cocina. Por eso `LodgingOffer.kitchen` tiene tres
    estados: `True` si figura (en la lista completa, antes del recorte a 12), `False` solo en alquileres que publican su
    lista y no la incluyen, y `None` (no se sabe) en hoteles sin el dato: que no figure no significa que no tenga.
    `require_kitchen` es un filtro duro en `lodging_rejection` (no cambia el modelo CP-SAT, que recibe candidatos ya
    filtrados): solo pasa `True`, y lo demás queda en el embudo con `lodging.no_kitchen` o `lodging.kitchen_unknown`,
    sin suponer que tienen cocina. Por defecto está apagado y el golden no se mueve. En la práctica deja solo
    alquileres, y en Nueva York (alquiler legal desde 30 noches) suele quedar sin opciones: la ayuda lo explica.
    `InfoTooltip` (`web/components/ui/InfoTooltip.tsx`): se abre con mouse, con foco de teclado y al tocar; Esc
    (sin cerrar el `<dialog>`), tocar afuera, scroll o resize lo cierran. Va en `position: fixed` y se acomoda dentro
    de la pantalla, así un carrusel no lo recorta ni ensancha la tarjeta. Va fuera de los `<label>` para que el nombre
    accesible del campo siga siendo solo la etiqueta. El texto de cada ayuda describe lo que hace el motor (baños por
    habitación, escalas por tramo, valijas por tramo).
16. **Base de la expansión: husos, deduplicación e interfaz (2026-11-06):**
    - **Husos:** `FlightOffer` guarda la hora local (referencia de la interfaz y del optimizador, sin cambios) y, si se
      conoce la zona de ambos aeropuertos, `depart_utc`, `arrive_utc` y `duration_min`. Tabla estática
      `engine/app/data/airport_tz.json` (7.917 aeropuertos, derivada de mwgg/Airports, MIT, porque OurAirports no trae
      zona). Aeropuerto desconocido = `None`, nunca una zona supuesta. Duración ≤ 0: el adapter descarta la oferta y
      avisa (`flight_illogical_duration`). Por ahora solo el adapter real calcula esto: fixture y simulado quedan sin
      duración. **Pendiente para Asia y Oceanía:** el armado de tramos (`skeletons.py`) admite salir el día del check-in
      o el anterior, así que un vuelo que salta un día entero (Los Ángeles → Sídney) todavía no se empareja. La línea de
      tiempo y el `.ics` ya lo soportan.
    - **Deduplicación:** `cached_entry` ya compartía las llamadas en curso, pero dentro del primer pedido: si ese pedido
      se cancelaba, los demás esperaban para siempre (deadlock, reproducido con un test). Ahora la llamada es una tarea
      propia y cada pedido espera con `shield`. Vale por proceso, que alcanza con una instancia en Render.
    - **`run_offers`:** una sola sentencia (`unnest`), atómica, y sin campos nulos en el JSON. **No** se guardan "solo las
      viables": el embudo y las tarjetas explican lo descartado con su motivo, y quitarlo rompería esa transparencia.
    - **Jerarquía de tarjetas:** `DemoBadge` se reemplaza por `CardInfo`, un único ⓘ con procedencia, comodidades, cocina
      y baños; a la vista quedan el precio y el estado principal. **Cambia la decisión 9** ("Dato de ejemplo" visible en
      cada tarjeta): el sello sigue en cada tarjeta, dentro del ⓘ, y el aviso general `fixture-notice` queda siempre a la
      vista. En producción no hay datos simulados, así que el caso real es "Cotizado hace X".
    - **Íconos:** lucide-react en lugar de emojis, con un test que impide volver a agregarlos. Costo: +13,2 KB gzip.
    - **Espera:** `TripPreview` muestra el recorrido y datos estables de los destinos (`lib/cityFacts.ts`) desde el pedido
      guardado, sin esperar al motor. Si no se puede leer el pedido, no se dibuja.
17. **Límite por conexión y cabeceras de aislamiento (2026-11-11):** se pidió un rate limit por IP en las rutas de
    Next (sugerido: Upstash). No se usó un contador en memoria de Vercel (cada instancia tiene el suyo: no limita de
    verdad) ni Upstash (otra cuenta y otro servicio para un dato que Postgres ya maneja con lock transaccional). La web
    calcula `HMAC-SHA256(IP, ENGINE_API_KEY)` recortado a 128 bits, **solo con la IP que pone Vercel** (`x-real-ip`;
    fuera de Vercel los headers se pueden inventar y no hay clave), y la manda al motor en `X-Client-Key`. El motor la
    cuenta en `run_clients` (RLS sin políticas ni GRANT: ni el dueño de la corrida la lee) dentro de la misma
    transacción que los demás límites, con tope `MAX_RUNS_PER_CLIENT_HOUR=20` y 429 `scope: client`. La IP nunca se
    guarda ni viaja; la clave se borra a las 24 h. En header y no en el cuerpo para que web y motor se puedan desplegar
    en cualquier orden. Cabeceras: se suman `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy: same-origin`
    y más permisos bloqueados; HSTS, `nosniff`, `X-Frame-Options: DENY` y la CSP con nonce ya estaban.
