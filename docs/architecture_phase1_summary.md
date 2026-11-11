# TravelOpt: resumen de arquitectura (Fase 1)

Documento anexo al [README](../README.md) para quien quiera entender el diseño del sistema, las decisiones y lo que
cada una cuesta. El registro completo de decisiones está en [`project_guidelines.md`](../project_guidelines.md).

## 1. Problema y alcance

Dado un origen, un conjunto de ciudades, la duración del viaje, la cantidad de viajeros, un presupuesto y condiciones
obligatorias, encontrar el itinerario de **menor costo total** que las cumpla todas. El itinerario incluye fechas,
vuelos por tramo, alojamiento por ciudad, actividades por día y traslados.

**Alcance de la Fase 1:** 7 ciudades de la Costa Este de EE. UU. y origen en Buenos Aires. Producción a costo cero.

## 2. Invariantes (no negociables)

| Invariante | Por qué |
|---|---|
| Dinero en `int` de centavos; impuestos en *basis points*, redondeo half-up por línea | Con `float`, 0.1 + 0.2 ≠ 0.3. En una factura es un error visible |
| Determinismo (CP-SAT con 1 worker y desempates explícitos) | Un resultado que cambia al repetir la búsqueda destruye la confianza y vuelve imposible probar |
| Restricciones duras = filtros con motivo registrado | El producto tiene que poder explicar por qué no hay resultados |
| El motor es el único escritor de la base | Reduce la superficie de ataque: el cliente no puede alterar precios ni resultados |
| Caso golden (USD 20,083.62) | Si un cambio mueve el óptimo, es un bug o una decisión explícita que se documenta en el mismo commit |

## 3. Flujo de una búsqueda

1. La web crea la búsqueda (`POST /v1/runs`) con la sesión anónima verificada. El motor aplica límites por usuario y
   globales en Postgres.
2. **Plan.** El motor enumera los *esqueletos* (orden de ciudades, fecha de salida, reparto de noches) y deriva el
   conjunto mínimo de consultas, deduplicado.
3. **Extracción en paralelo** de 5 tipos de datos. Cada consulta pasa por la caché en Postgres y por la deduplicación de
   pedidos en curso antes de tocar la red. Vuelos y alojamiento son críticos (si fallan, la búsqueda falla). Clima y
   actividades no: tienen timeout de 4 s y degradan con aviso.
4. **Optimización.** Filtros duros, después subproblemas CP-SAT por estadía (unidades de alojamiento) y por ciudad
   (calendario de actividades), memoizados entre esqueletos. Salen los 3 mejores itinerarios.
5. **Persistencia y entrega.** El motor guarda ofertas e itinerarios. La web recibe el progreso por Supabase Realtime,
   con sondeo cada 3 s como respaldo.

## 4. Modelo de optimización

- **Variables.** Elección de oferta por tramo y por estadía, cantidad de unidades por tipo de alojamiento y asignación
  de actividad a día.
- **Restricciones.** Capacidad, baños y dormitorios mínimos del grupo. Escalas y horarios por tramo. Estadía mínima.
  Legalidad del alquiler temporario. Clima (lluvia fuerte y calor) para actividades al aire libre. Capacidad diaria y
  máximo de días completos seguidos.
- **Objetivo.** Minimizar el costo total final (tarifas, impuestos por línea, valijas, limpieza, entradas y traslados).
- **Validación.** Un oráculo de fuerza bruta implementa la misma semántica enumerando todo. Los tests comparan ambos.

**Por qué CP-SAT y no una heurística propia:** el problema mezcla decisiones enteras (cuántas habitaciones de cada
tipo), restricciones de capacidad y calendario. CP-SAT da el óptimo con prueba de optimalidad. Una heurística daría
"un buen viaje" sin poder demostrar que es el más barato.

## 5. Datos y proveedores

| Dato | Fuente | Detalle |
|---|---|---|
| Vuelos y hoteles | SerpApi (Google Flights / Google Hotels) | Cuota de 250/mes: caché, tope por corrida, modo histórico |
| Clima | Open-Meteo (climatología de 10 años, 1 llamada por ciudad), OpenWeather opcional | Histórico sin vencimiento en caché |
| Actividades | Precios publicados curados con fuente + lugares de Wikidata | Sin precio publicado: "entrada sujeta a taquilla", no se suma al total |
| Rutas | OSRM | Caché permanente |
| Eventos | Ticketmaster Discovery + Google Events precargado por cron | |
| Zonas horarias | Tabla estática de 7.917 aeropuertos (mwgg/Airports, MIT) | Desconocida = `None` |

**Modelado de la incertidumbre.** Un dato que el proveedor no informa queda como "no se sabe", no como un valor
supuesto. Ejemplo: la cocina tiene tres estados (`true`, `false`, `null`). En la respuesta real de Google Hotels, los
alquileres la informan y los hoteles no. Una restricción dura solo deja pasar lo verificado: tratar "no figura" como
"no tiene" descartaría opciones válidas, y tratarlo como "tiene" recomendaría algo que no cumple lo que se pidió como
obligatorio.

## 6. Confiabilidad

- **HTTP.** Reintentos con *backoff* exponencial y jitter, respeto de `Retry-After`, circuit breaker por proveedor y
  lista blanca de hosts de salida (SSRF).
- **Deduplicación de pedidos en curso.** Una sola llamada compartida que corre en una tarea propia. Cada pedido espera
  con `asyncio.shield`, así que cancelar a uno no cancela a los demás ni los deja colgados. Se encontró y corrigió un
  deadlock real de la versión anterior, reproducido con un test.
- **Corridas colgadas.** Un *reaper* periódico las marca como fallidas. La retención de 30 días borra búsquedas, caché
  vencido y logs.
- **Alertas.** Log JSON y webhook asíncrono con *throttling* (1 aviso por tipo cada 15 min) y contexto sin datos
  personales.

## 7. Seguridad y privacidad

- **Datos.** RLS en todas las tablas, cubierta con tests pgTAP. Escritura solo desde el motor (conexión directa).
- **Identidad.** Sesión anónima con CAPTCHA (Cloudflare Turnstile), cookies de sesión del navegador, sin registro.
- **Navegador.** CSP con nonce por request y `strict-dynamic`. Links externos saneados (`safeHref`). Ningún secreto en
  variables públicas.
- **CI.** gitleaks en cada push. Migraciones versionadas, probadas con `db reset` + pgTAP antes de aplicarse en
  producción con *dry-run*.
- **Privacidad (Ley 25.326).** Minimización de datos: búsquedas anónimas que se borran solas a los 30 días.

## 8. Producción a costo cero

| Pieza | Servicio | Costo aceptado |
|---|---|---|
| Web | Vercel Hobby | Sin dominio propio |
| Motor | Render Free (orquestador en proceso, sin n8n) | Arranque en frío de ~40 s: warm-up, aviso y pantalla de espera |
| Base | Supabase Free | 500 MB: retención de 30 días y JSON sin campos nulos |
| Despertador | UptimeRobot | |

## 9. Límites conocidos y próximos pasos

- **Cuota de datos.** Con 250 búsquedas por mes no escala a muchos usuarios. Se degrada bien, pero no escala. Siguiente
  paso: caché compartida por ruta y precarga de rutas populares.
- **Vuelos que saltan un día entero** (Los Ángeles → Sídney). La línea de tiempo y el `.ics` ya los soportan; el armado
  de tramos del optimizador todavía no.
- **Reglas legales.** Dependen de fuentes y algunas son secundarias. No son asesoramiento legal.
- **Fase 2 (expansión).** Catálogo de ciudades en la base con lectura pública y escritura solo para `service_role`,
  reglas legales por ciudad leídas por el motor, presentación multi-moneda y Costa Oeste.
