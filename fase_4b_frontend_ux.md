# Fase 4b: rediseño del frontend (UX)

**Objetivo:** pasar del formulario técnico a un flujo de producto: landing → onboarding → hub de vuelos → dashboard por ciudad → checkout con timeline. El optimizador sigue siendo el que decide: cada pantalla muestra **su elección preseleccionada** y el usuario puede cambiarla con "Seleccionar", y el subtotal flotante se recalcula en centavos.
**Requisito previo:** `GATE FASE 4: OK`.
**Regla:** los valores por defecto del onboarding reproducen el caso golden (`buildTripRequest(DEFAULTS)` = `lib/demo-case.json`, con un test unitario).

---

## Sistema de diseño

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#FFFFFF` | Fondo principal |
| `--color-surface` | `#F9FAFB` | Secciones alternas, tarjetas |
| `--color-ink` | `#111827` | Texto (contraste 17:1) |
| `--color-muted` | `#6B7280` | Texto secundario |
| `--color-accent` | `#4F46E5` (Azul Eléctrico) | Botones y destacados (blanco encima 6,3:1, AA) |
| Títulos | Poppins 800/900 | `font-display` |
| Cuerpo | Inter | `font-sans` |

Solo modo claro: la variante `dark:` de Tailwind queda atada a una clase `.dark` que no se usa.
Las animaciones respetan `prefers-reduced-motion`.

## Estructura de componentes

```
web/
├─ app/
│  ├─ page.tsx                      Pantalla 1: landing (Server Component)
│  └─ runs/[id]/page.tsx            Pantallas 3–5 (hoy: vista de resultado de la Fase 4)
├─ components/
│  ├─ ui/                           Button, NumberField, Stepper (sin estado de negocio)
│  ├─ landing/                      SiteHeader, Hero, HowItWorks, Promise
│  ├─ onboarding/                   Pantalla 2
│  │  ├─ OnboardingLauncher.tsx     CTA "Armamos tu viaje" + estado abierto/cerrado
│  │  ├─ OnboardingModal.tsx        <dialog> nativo (foco atrapado, Esc), 3 pasos, envío
│  │  ├─ StepDestinations.tsx       ciudades múltiples, orden, noches por ciudad
│  │  ├─ StepDates.tsx              ventana de check-in, duración, viajeros, presupuesto
│  │  └─ StepPreferences.tsx        restricciones duras (baños, escalas, lluvia…)
│  ├─ flights/        (4b.2)        FlightHub, FlightCard: ≥ 5 opciones, "Seleccionar"
│  ├─ city/           (4b.3)        CityDashboard ×N: Weather, Mobility, LodgingFeed, ActivityPlan
│  ├─ checkout/       (4b.4)        Timeline día por día, SubtotalPanel, Confirmar
│  └─ cart/           (4b.2)        CartProvider + SubtotalDock flotante
└─ lib/
   ├─ cities.ts                     catálogo de destinos (aeropuertos, coordenadas, imperdibles)
   └─ onboarding.ts                 estado del formulario → TripRequest + validación
```

## Entregas

| Etapa | Pantallas | Datos |
|---|---|---|
| 4b.1 | Landing + modal de onboarding | `POST /api/trips` (sin cambios en el motor) |
| 4b.2 | Hub de vuelos + carrito/subtotal | Ofertas de la corrida: requiere exponer `offers` por RLS o vía `/api/runs/[id]/offers` |
| 4b.3 | Dashboard por ciudad (drag & drop del orden, clima, movilidad, alojamiento, actividades) | Ofertas + clima de la corrida; reordenar = nueva corrida con `fixed_order` |
| 4b.4 | Checkout + timeline | Itinerario elegido + selección del usuario, conciliado al centavo |

En modo fixture solo Orlando y NYC tienen datos; el resto del catálogo se muestra como "Próximamente" hasta decidir proveedores (ADR 0001).

## Checkpoints 4b.1

| ID | Check | OK si… |
|---|---|---|
| CP-4b.1 | Defaults = golden | Test unitario: `buildTripRequest(DEFAULTS)` igual a `demo-case.json` con el reparto del óptimo (8 + 4 noches; decisión 4 de `project_guidelines.md`) |
| CP-4b.2 | Validación | Tests: sin ciudades, noches mín > máx, fechas invertidas y duración fuera de rango dan error |
| CP-4b.3 | Modal accesible | Se abre sin recargar, Esc lo cierra, el foco queda dentro y vuelve al CTA al cerrar |
| CP-4b.4 | E2E | Los 3 E2E de la Fase 4 pasan entrando por "Armamos tu viaje" |
| CP-4b.5 | Mobile 375 px | Landing y modal sin scroll horizontal |
| CP-4b.6 | Gate | `uv run python scripts/gate.py 4` da OK |

## 4b.2: Hub de vuelos y subtotal flotante (2026-10-27)

**Datos:** migración `20261027165051_run_offers_owner_read.sql`: cada usuario lee solo las ofertas de sus corridas (pgTAP 10/10).
**Regla de tramos y costos:** `lib/flights.ts` es un port de `engine/app/optimizer/{skeletons,filters}.py`
(`leg_matches`, `flight_rejection`, `flight_cost`). Si cambia el motor, se cambia acá en el mismo commit.
**Carrito:** `lib/cart.ts` parte del óptimo y suma diferencias en centavos; sin cambios da exactamente el total del motor.

| ID | Check | Resultado |
|---|---|---|
| CP-4b.7 | Port = motor | ✅ Test: la opción elegible más barata por tramo es la del óptimo (F02 465000 · F13 88500 · F21 495000) |
| CP-4b.8 | Carrito al centavo | ✅ Test: sin cambios 2008362; F01 en la ida → +25000 exacto |
| CP-4b.9 | ≥ 5 opciones | ✅ 6 vuelos para las fechas del óptimo; los descartados se muestran con su motivo (F14: "Sale antes de tu hora mínima") |
| CP-4b.10 | E2E hub | ✅ Elegir F01 → USD 20,333.62 (+250.00); "Volver al óptimo" → 20,083.62 |
| CP-4b.11 | RLS de ofertas | ✅ pgTAP: B no ve ofertas de A; nadie borra desde el navegador |
| CP-4b.12 | Mobile 375 px | ✅ Sin scroll horizontal; subtotal como barra inferior desplegable |

**Bug encontrado y corregido:** con `cacheComponents`, Next conserva la landing oculta (`<Activity>`) al navegar. El
`<dialog>` modal seguía en la capa superior y dejaba inerte la página de resultados. El modal ahora se cierra al ocultarse.

**Límite actual:** solo se muestran vuelos de las fechas del itinerario óptimo. Cambiar a un vuelo de otro día
cambia las noches de alojamiento; eso llega con el dashboard por ciudad (4b.3), que recalcula el esqueleto.

### Ajustes 4b.2 (pedido del usuario)

- "Tus vuelos" con pestañas **Ida / Interconexión / Vuelta / Todos**; cada pestaña muestra el precio del vuelo elegido
  (tablist accesible, flechas ← → para moverse).
- **Detalle del itinerario óptimo** plegado, con el total y el aviso de presupuesto en el encabezado. Es provisorio:
  su contenido pasa al checkout (4b.4).
- **¿Qué quedó afuera?** (embudo de factibilidad) plegado y agrupado por vuelos, alojamiento y actividades, con las
  combinaciones de fechas en lenguaje claro. Se abre solo cuando la corrida da `infeasible`.

## 4b.3: Dashboard por ciudad (2026-10-27)

**Motor:** `lodging_options()` (`engine/app/optimizer/lodging.py`) calcula por estadía todas las propiedades con su
mejor combinación de unidades (mismo modelo CP-SAT que `solve_lodging`, restringido a cada oferta) o el motivo de
descarte. Se guarda en `itineraries.payload.stays[].lodging_options`. No mueve el golden (test).

| Bloque | Datos | Interacción |
|---|---|---|
| Orden del viaje | `trip_requests.payload.cities` | Arrastrar y soltar (o ← →) + "Recalcular": corrida nueva con `fixed_order` |
| Clima | `run_offers` kind `weather` | Informativo: días vetados por lluvia/calor marcados, consejo para la valija |
| Movilidad | `run_offers` kind `transport` + costo del itinerario | Informativo (1 cotización por ciudad en el fixture) |
| Alojamiento | `lodging_options` del motor | "Seleccionar" cambia la propiedad y mueve el subtotal al centavo |
| Actividades | Plan del motor día por día | Informativo con link de compra; días de llegada, libres y con lluvia explicados |

| ID | Check | Resultado |
|---|---|---|
| CP-4b.13 | Alternativas = motor | ✅ pytest: la primera elegible de cada estadía es la elegida, al mismo costo; descartes coinciden con el embudo |
| CP-4b.14 | E2E alojamiento | ✅ H1 en Orlando → USD 20,860.67 (+777.05); H3 "Menos baños que tu mínimo"; N3 "Alquiler temporario no legal" |
| CP-4b.15 | E2E widgets | ✅ Movilidad Orlando USD 772.00; Epic Universe agendado el 9/7 |
| CP-4b.16 | E2E reordenar | ✅ Nueva York → Orlando lanza una corrida nueva; en el fixture da `infeasible` ("no encontramos vuelos para la ida a Nueva York") |
| CP-4b.17 | Gates | ✅ Gate 3 (411 tests) y gate 4 (7 E2E) |

**Límites:** las actividades no se cambian de día desde la UI (moverlas exige re-resolver la secuencia con la regla de
días seguidos); movilidad y "Disponibilidad verificada" dependen de proveedores reales (en el fixture se ve "Datos de prueba").

## 4b.4: Checkout y calendario final (2026-10-28)

- **Tu viaje, día por día** (`components/checkout/Timeline.tsx`): una fila por día con dónde dormís (propiedad
  elegida), vuelos con horario y actividades; noches en vuelo y regreso a casa explícitos.
- **Resumen** (`lib/checkout.ts::rubros`): Vuelos (ida y vuelta) + Interconexiones + Alojamiento + Actividades +
  Movilidad, total final, reparto por persona (resto mayor, igual que el motor) y aviso de presupuesto.
- **Confirmar itinerario:** TravelOpt no reserva. Confirmar fija la selección y lista los links de compra de cada
  parte (vuelos, alojamiento, entradas, movilidad), con "Imprimir o guardar en PDF".
- **Persistencia:** las elecciones se recuerdan por corrida en el navegador (`localStorage`, con `try/catch`).
- El "Detalle del itinerario óptimo" provisorio se quitó: su contenido vive en el checkout.

| ID | Check | Resultado |
|---|---|---|
| CP-4b.18 | Reparto por persona | ✅ Test: 2008362 / 5 → 401673 ×2 + 401672 ×3 |
| CP-4b.19 | Rubros al centavo | ✅ Test: vuelos 960000 + interconexiones 88500 + … = 2008362 |
| CP-4b.20 | Calendario | ✅ Test y E2E: noche en vuelo el 20/7, en casa el 21/7, Epic Universe el 9/7 |
| CP-4b.21 | E2E checkout | ✅ Confirmar lista los links; cambiar a H1 actualiza total (20,860.67) y calendario; persiste al recargar |
| CP-4b.22 | Gate | ✅ `GATE FASE 4: OK` (8 E2E) |

**Bug encontrado y corregido:** leer el storage en un efecto fallaba en desarrollo (StrictMode repite los efectos y
el guardado pisaba la carga). El carrito ahora lo lee al inicializar el estado; es seguro porque se monta solo en el cliente.

## 4b.5: Mejoras de la revisión (2026-10-28)

Pedido del usuario: todas las mejoras propuestas + catálogo de actividades + quitar la pregunta de parques.

| Mejora | Cómo quedó |
|---|---|
| Flujo por pasos | Vuelos → cada ciudad → Tu viaje, de a uno, con "Siguiente/Atrás" y el subtotal siempre visible |
| Encabezado de resultados | Logo + "Nuevo viaje"; el progreso se ve solo mientras calcula; el estado técnico queda solo para lectores de pantalla y tests |
| Aviso único de datos de ejemplo | Un banner arriba; se quitó "Datos de prueba" de cada tarjeta ("Disponibilidad verificada" solo con proveedor real) |
| Descartadas plegadas | "Ver N descartadas y por qué" en vuelos y alojamiento |
| Clima | Grilla que se adapta: entran todos los días, sin scroll |
| Mapa del recorrido | SVG propio (proyección de coordenadas reales, sin proveedor de mapas) |
| Portada por ciudad | Degradé por destino (fotos: requieren proveedor de imágenes) |
| Combinaciones de fechas | Las 3 del motor lado a lado; cada una se puede abrir con su propio carrito |
| Catálogo de actividades | "Qué se puede hacer": todo el catálogo de la ciudad; se marca lo deseado y "Optimizar calendario" lanza una corrida con esos `must_do`. Debajo, "Tu calendario optimizado" |
| Sin parques en las preguntas | Se quitó "Días de parque seguidos" del onboarding (queda el valor por defecto, 3); textos de lluvia generalizados a "actividades al aire libre" |

**Datos:** el fixture suma 3 actividades opcionales por ciudad (Kennedy Space Center, ICON Park, Medieval Times; Museo de
Historia Natural, Circle Line, Broadway). Las imperdibles no cambian: **el golden sigue en USD 20,083.62** y el embudo es el
mismo. Las ofertas de actividades extraídas pasan de 57 a 99 (tests y documentos de las fases 1 y 2 actualizados).

| ID | Check | Resultado |
|---|---|---|
| CP-4b.23 | Golden intacto | ✅ Gate 3 (411 tests) y CLI: 20,083.62 con el mismo embudo |
| CP-4b.24 | E2E catálogo | ✅ 8 actividades en Orlando; sumar Medieval Times re-optimiza → USD 20,433.62 (+350.00 = 5 × 70) |
| CP-4b.25 | E2E flujo por pasos | ✅ 9 E2E pasan navegando por pasos; elecciones persisten al recargar |
| CP-4b.26 | Gate | ✅ `GATE FASE 4: OK` |
