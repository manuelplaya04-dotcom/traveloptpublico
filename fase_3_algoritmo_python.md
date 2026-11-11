# Fase 3: algoritmo de optimización (Python)

**Objetivo:** dadas las ofertas extraídas, encontrar el itinerario de **menor costo total exacto** que cumpla todas las restricciones duras, explicar los descartes y producir la calculadora financiera conciliada al centavo.
**Requisito previo:** `GATE FASE 2: OK`.
**Salida:**
- optimizador (CP-SAT + descomposición), calculadora financiera y servicio de optimización;
- 343 tests en verde;
- flujo vía n8n terminando en `done` con **USD 20,083.62**.

---

## 3.1 Formulación matemática

### Conjuntos

| Símbolo | Significado |
|---|---|
| $S$ | Esqueletos $s = (\pi, d_0, \mathbf{n})$: orden de ciudades $\pi$, primer check-in $d_0 \in [D^{from}, D^{to}]$ y noches por ciudad $n_c \in [n_c^{\min}, n_c^{\max}]$, con $\sum_c n_c \in [N^{\min}, N^{\max}]$ |
| $L(s)$, $T(s)$ | Tramos aéreos y estadías que determina $s$ |
| $\hat F_\ell$ | Ofertas de vuelo del tramo $\ell$ que pasan los filtros duros |
| $H_t$, $U_h$ | Propiedades candidatas de la estadía $t$ y sus tipos de unidad |
| $K_t$ | Actividades obligatorias de la ciudad de $t$ |
| $D_t$ | Días útiles de $t$: días calendario estrictos entre check-in y check-out |
| $O_{kt}$ | Ofertas (fechas) de la actividad $k$ dentro de $D_t$ que pasan la veda climática |

### Parámetros

| Símbolo | Significado |
|---|---|
| $P, B, R, M$ | Pasajeros, baños mínimos, dormitorios mínimos, máximo de días completos seguidos |
| $c_f = P\,\big(p_f + \beta_f \max(0,\, b - i_f)\big)$ | Costo del vuelo $f$: tarifa más valijas extra ($b$ por pax, $i_f$ incluidas, $\beta_f$ por valija) |
| $\kappa_{hu}, \rho_{hu}, \delta_{hu}, a_{hu}$ | Capacidad, baños, dormitorios y disponibilidad de la unidad $u$ |
| $q_{hu} = \mathrm{tax}(\mathrm{base}_{hu}) + \mathrm{tax}(\mathrm{fees}_{hu})$ | Costo final de una unidad por toda la estadía |
| $\phi_h = \mathrm{tax}(\mathrm{limpieza}_h)$ | Cargo fijo por reserva |
| $\pi_o, \sigma_k$ | Precio por pax de la oferta $o$; slots de $k$ (2 = día completo, 1 = medio día) |
| $\theta_t$ | Transporte de la estadía: `con_impuesto(diario·noches + por_viaje·viajes + fijo)` |

$\mathrm{tax}(x) = x + \big\lfloor (x\,\tau + 5000)/10000 \big\rfloor$, con $\tau$ en basis points: half-up por línea, aritmética entera.

### Variables

$y_s \in \{0,1\}$ · $x_{s\ell f} \in \{0,1\}$ · $p_{th} \in \{0,1\}$ · $n_{thu} \in \mathbb{Z}_{\ge 0}$ · $z_{tko} \in \{0,1\}$

### Objetivo

$$
\min \sum_{s \in S} \Big[ \sum_{\ell \in L(s)} \sum_{f \in \hat F_\ell} c_f\, x_{s\ell f}
+ \sum_{t \in T(s)} \Big( \sum_{h} \phi_h\, p_{th} + \sum_{h,u} q_{hu}\, n_{thu} + \sum_{k,o} P\,\pi_o\, z_{tko} + \theta_t\, y_s \Big) \Big]
$$

### Restricciones

| # | Restricción | Sentido |
|---|---|---|
| R1 | $\sum_s y_s = 1$ | Se elige un esqueleto |
| R2 | $\sum_{f \in \hat F_\ell} x_{s\ell f} = y_s \quad \forall s, \ell$ | Un vuelo por tramo del esqueleto elegido |
| R3 | $\sum_{h \in H_t} p_{th} = y_s \quad \forall s, t$ | Una sola propiedad por estadía (el grupo no se divide) |
| R4 | $n_{thu} \le a_{hu}\, p_{th}$ | Solo hay unidades en la propiedad elegida, hasta su disponibilidad |
| R5 | $\sum_u \kappa_{hu} n_{thu} \ge P p_{th}$ · $\sum_u \rho_{hu} n_{thu} \ge B p_{th}$ · $\sum_u \delta_{hu} n_{thu} \ge R p_{th}$ | Cobertura de capacidad, **baños** y dormitorios |
| R6 | $\sum_{o \in O_{kt}} z_{tko} = y_s \quad \forall k \in K_t$ | Cada actividad obligatoria, exactamente una vez |
| R7 | $\sum_{k,o:\, d(o)=d} \sigma_k z_{tko} \le 2 \quad \forall d \in D_t$ | Capacidad diaria: 2 medios días |
| R8 | $\sum_{d \in W} \sum_{k:\, \sigma_k = 2} \sum_{o:\, d(o)=d} z_{tko} \le M \quad \forall W$ de $M+1$ días consecutivos | Fatiga: a lo sumo $M$ días de parque seguidos |

**Restricciones duras como reducción de dominio.** Se aplican antes del modelo y su motivo queda en el embudo:
- **Vuelos:** ruta; fecha de salida admitida (incluye el nocturno del día anterior); llegada el día del check-in; escalas ≤ máx.; salida ≥ hora mínima; llegada ≤ hora máxima; asientos ≥ $P$.
- **Alojamiento:** legalidad del alquiler temporario; noches ≥ mínimo de la propiedad; y que capacidad, baños y dormitorios **alcanzables** cubran lo requerido.
- **Actividades:** si es outdoor, $P(\text{lluvia} \ge 10\text{ mm}) \le$ umbral y $t_{\max} \le$ umbral. Las fechas cerradas no generan oferta y los días de viaje quedan excluidos.

**Presupuesto.** No es una restricción del modelo, a propósito. Si el óptimo lo supera, se informa `over_budget` con la **brecha exacta**. "No hay solución" no le sirve al usuario; "te faltan USD 83.62" sí.

## 3.2 Descomposición exacta

**Proposición.** Con $s$ fijo ($y_s = 1$), R2–R8 se dividen en bloques disjuntos: uno por tramo, uno de alojamiento por estadía y uno de actividades por estadía. Ninguna variable ni restricción se comparte entre bloques, y el objetivo es la suma de los costos de bloque. Por lo tanto:

$$
z^* = \min_{s \in S} \Big[ \sum_{\ell \in L(s)} \min_{f \in \hat F_\ell} c_f + \sum_{t \in T(s)} \big( \mathrm{Aloj}^*_t + \mathrm{Act}^*_t + \theta_t \big) \Big]
$$

Si algún bloque es infactible, $s$ es infactible. $S$ se enumera completo; el caso tiene 6 esqueletos. Así se obtiene el **óptimo global exacto**, no una aproximación.

- **Bloque vuelo:** `argmin` directo sobre $\hat F_\ell$. No necesita solver.
- **Bloque alojamiento:** cobertura entera chica (R3–R5), con CP-SAT.
- **Bloque actividades:** no alcanza con el algoritmo húngaro. R7 permite dos medios días en el mismo día y R8 acopla días consecutivos. Se resuelve con CP-SAT.
- **Memo:** los bloques repetidos entre esqueletos (mismo tramo, misma estadía) se resuelven una vez. En el caso: 8 tramos y 10 estadías únicas.

## 3.3 Decisiones de implementación

| Decisión | Motivo |
|---|---|
| **CP-SAT** (OR-Tools) | Datos enteros en centavos sin error de coma flotante; restricciones condicionales (`only_enforce_if`); muy rápido en modelos combinatorios chicos. Un MILP (HiGHS o CBC) también serviría: el modelo es lineal |
| `num_workers = 1` y límite de 5 s | Determinismo y tiempo acotado. El flag `all_subproblems_optimal` avisa si algún bloque no probó optimalidad |
| Desempate en actividades: $\mathrm{SCALE}\cdot\mathrm{costo} + \sum$ (lluvia en ‰), con $\mathrm{SCALE} = 1000(\lvert K \rvert + 1)$ | Como el desempate es $\le 1000\lvert K \rvert < \mathrm{SCALE}$, **nunca** cambia el costo óptimo. Entre empates prefiere días más secos |
| Ranking por `(total, skeleton_id)` | Orden total y estable del top-N |
| Oráculo de fuerza bruta con la misma semántica | Valida CP-SAT al centavo en el caso real y en 300 instancias aleatorias |
| Calculadora con las **mismas** funciones de dinero que el solver | La conciliación es por construcción. Si difiere en 1 centavo, lanza `ReconciliationError` |
| Prorrateo por persona con el método del mayor resto | $\sum$ partes $=$ total exacto |
| Optimización en `asyncio.to_thread` | No bloquea el event loop de la API |

## 3.4 Código

**`engine/app/optimizer/filters.py`**

```python
"""Filtros de factibilidad (restricciones duras) y costos unitarios.

Cada filtro devuelve None si la oferta es factible o un código de motivo si se descarta.
Los motivos alimentan el "embudo de factibilidad" que se muestra al usuario.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import time

from app.domain.models import (
    ActivityOffer,
    Constraints,
    FlightOffer,
    LodgingOffer,
    LodgingUnit,
    TransportQuote,
    WeatherDay,
)
from app.domain.money import with_tax
from app.optimizer.skeletons import Leg, Stay


@dataclass
class Diagnostics:
    rejections: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    infeasible_skeletons: dict[str, str] = field(default_factory=dict)
    warnings: set[str] = field(default_factory=set)

    def reject(self, reason: str, offer_id: str) -> None:
        self.rejections[reason].add(offer_id)

    def summary(self) -> dict:
        return {
            "rejections": {k: sorted(v) for k, v in sorted(self.rejections.items())},
            "infeasible_skeletons": dict(sorted(self.infeasible_skeletons.items())),
            "warnings": sorted(self.warnings),
        }


# ---------------------------------------------------------------- vuelos


def leg_matches(f: FlightOffer, leg: Leg) -> bool:
    return (
        f.origin in leg.origin_airports
        and f.destination in leg.dest_airports
        and f.depart_at.date() in leg.depart_dates
        and (leg.arrive_on is None or f.arrive_at.date() == leg.arrive_on)
    )


def flight_rejection(f: FlightOffer, leg: Leg, c: Constraints, pax: int) -> str | None:
    if f.stops > c.max_stops:
        return "flight.too_many_stops"
    if f.depart_at.time() < time(c.earliest_departure_hour):
        return "flight.departs_too_early"
    if leg.arrive_on is not None and f.arrive_at.time() > time(c.latest_arrival_hour):
        return "flight.arrives_too_late"
    if f.seats_available < pax:
        return "flight.insufficient_seats"
    return None


def flight_extra_bags(f: FlightOffer, c: Constraints) -> int:
    return max(0, c.checked_bags_per_pax - f.included_bags)


def flight_cost(f: FlightOffer, c: Constraints, pax: int) -> int:
    return pax * (f.price_per_pax_minor + flight_extra_bags(f, c) * f.bag_fee_minor)


# ---------------------------------------------------------------- alojamiento


def lodging_rejection(o: LodgingOffer, stay: Stay, c: Constraints, pax: int) -> str | None:
    if not o.short_term_legal:
        return "lodging.short_term_not_legal"
    if stay.nights < o.min_nights:
        return "lodging.min_nights"
    if sum(u.capacity * u.available for u in o.units) < pax:
        return "lodging.capacity"
    if sum(u.bathrooms * u.available for u in o.units) < c.min_bathrooms:
        return "lodging.bathrooms"
    if sum(u.bedrooms * u.available for u in o.units) < c.min_bedrooms:
        return "lodging.bedrooms"
    return None


def unit_cost(o: LodgingOffer, u: LodgingUnit) -> int:
    """Costo final de UNA unidad por toda la estadía (impuesto redondeado por línea)."""
    return with_tax(u.base_total_minor, o.tax_bps) + with_tax(u.fees_total_minor, o.tax_bps)


def stay_fee_cost(o: LodgingOffer) -> int:
    return with_tax(o.stay_fee_minor, o.tax_bps)


# ---------------------------------------------------------------- actividades


def activity_rejection(a: ActivityOffer, w: WeatherDay | None, c: Constraints) -> str | None:
    if not a.outdoor or w is None:
        return None
    if w.heavy_rain_prob > c.max_heavy_rain_prob:
        return "activity.weather_rain"
    if w.tmax_c > c.max_tmax_c:
        return "activity.weather_heat"
    return None


# ---------------------------------------------------------------- transporte


def transport_base(q: TransportQuote, stay: Stay) -> int:
    return q.per_day_minor * stay.nights + q.per_trip_minor * q.trips + q.fixed_minor


def transport_cost(q: TransportQuote, stay: Stay) -> int:
    return with_tax(transport_base(q, stay), q.tax_bps)
```

**`engine/app/optimizer/lodging.py`**

```python
"""Subproblema de alojamiento por estadía: cobertura entera de capacidad y baños (CP-SAT).

min  sum_h fee_h * p_h + sum_{h,u} cost_{h,u} * n_{h,u}
s.a. sum_h p_h = 1                                   (una sola propiedad: el grupo no se divide)
     0 <= n_{h,u} <= avail_{h,u} * p_h
     sum_u cap_{h,u}  * n_{h,u} >= pax          si p_h
     sum_u bath_{h,u} * n_{h,u} >= min_baños    si p_h
     sum_u bed_{h,u}  * n_{h,u} >= min_dorm     si p_h
"""
from __future__ import annotations

from dataclasses import dataclass

from ortools.sat.python import cp_model

from app.domain.models import Constraints, LodgingOffer
from app.optimizer.filters import Diagnostics, lodging_rejection, stay_fee_cost, unit_cost
from app.optimizer.skeletons import Stay

SOLVER_TIME_LIMIT_S = 5.0


@dataclass(frozen=True)
class LodgingChoice:
    offer: LodgingOffer
    units: tuple[tuple[int, int], ...]  # (índice de unidad en la oferta, cantidad)
    cost_minor: int
    optimal: bool


def new_solver() -> cp_model.CpSolver:
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = SOLVER_TIME_LIMIT_S
    s.parameters.num_workers = 1  # determinismo: misma entrada -> misma salida
    return s


def lodging_candidates(
    stay: Stay, offers: list[LodgingOffer], c: Constraints, pax: int, diag: Diagnostics
) -> list[LodgingOffer]:
    out = []
    for o in offers:
        if (o.city, o.check_in, o.check_out) != (stay.city, stay.check_in, stay.check_out):
            continue
        reason = lodging_rejection(o, stay, c, pax)
        if reason:
            diag.reject(reason, o.id)
            continue
        out.append(o)
    return sorted(out, key=lambda o: o.id)


def choice_cost(o: LodgingOffer, units: tuple[tuple[int, int], ...]) -> int:
    return stay_fee_cost(o) + sum(q * unit_cost(o, o.units[j]) for j, q in units)


def solve_lodging(
    stay: Stay, offers: list[LodgingOffer], c: Constraints, pax: int, diag: Diagnostics
) -> LodgingChoice | None:
    cands = lodging_candidates(stay, offers, c, pax, diag)
    if not cands:
        return None
    m = cp_model.CpModel()
    pick, qty, cost_terms = {}, {}, []
    for i, o in enumerate(cands):
        p = m.new_bool_var(f"p_{i}")
        pick[i] = p
        cost_terms.append(stay_fee_cost(o) * p)
        cap, bath, bed = [], [], []
        for j, u in enumerate(o.units):
            n = m.new_int_var(0, u.available, f"n_{i}_{j}")
            m.add(n <= u.available * p)
            qty[(i, j)] = n
            cost_terms.append(unit_cost(o, u) * n)
            cap.append(u.capacity * n)
            bath.append(u.bathrooms * n)
            bed.append(u.bedrooms * n)
        m.add(sum(cap) >= pax).only_enforce_if(p)
        m.add(sum(bath) >= c.min_bathrooms).only_enforce_if(p)
        m.add(sum(bed) >= c.min_bedrooms).only_enforce_if(p)
    m.add_exactly_one(pick.values())
    m.minimize(sum(cost_terms))

    solver = new_solver()
    status = solver.solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    for i, o in enumerate(cands):
        if solver.value(pick[i]):
            units = tuple(
                (j, solver.value(qty[(i, j)]))
                for j in range(len(o.units))
                if solver.value(qty[(i, j)]) > 0
            )
            return LodgingChoice(o, units, choice_cost(o, units), status == cp_model.OPTIMAL)
    return None
```

**`engine/app/optimizer/activities.py`**

```python
"""Subproblema de actividades por estadía: asignación actividad -> día (CP-SAT).

Variables x_{k,o} = 1 si la actividad obligatoria k se hace con la oferta o (oferta = fecha).
min  SCALE * sum costo_{k,o} * x_{k,o}  +  sum desempate_{k,o} * x_{k,o}
s.a. sum_o x_{k,o} = 1                                     cada must-do exactamente una vez
     sum_{k,o: fecha=d} slots_k * x_{k,o} <= 2             capacidad diaria (2 medios días)
     sum_{d en ventana de M+1 días} full_d <= M            máx. M días completos seguidos
Las ofertas outdoor con clima fuera de umbral ya fueron eliminadas (restricción dura).
El desempate (lluvia esperada en ‰) nunca puede superar una unidad de costo.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from ortools.sat.python import cp_model

from app.domain.models import ActivityOffer, Constraints, WeatherDay
from app.optimizer.filters import Diagnostics, activity_rejection
from app.optimizer.lodging import new_solver
from app.optimizer.skeletons import Stay, usable_days

DAY_SLOTS = 2


@dataclass(frozen=True)
class ActivityPlan:
    items: tuple[ActivityOffer, ...]  # ordenadas por fecha
    cost_minor: int
    optimal: bool


def activity_options(
    stay: Stay,
    must_do: list[str],
    offers: list[ActivityOffer],
    weather: dict[tuple[str, object], WeatherDay],
    c: Constraints,
    diag: Diagnostics,
) -> dict[str, list[ActivityOffer]] | None:
    days = set(usable_days(stay, c))
    opts: dict[str, list[ActivityOffer]] = {k: [] for k in must_do}
    for a in offers:
        if a.city != stay.city or a.activity_key not in opts or a.date not in days:
            continue
        w = weather.get((a.city, a.date))
        if w is None and a.outdoor:
            diag.warnings.add(f"sin_clima:{a.city}:{a.date.isoformat()}")
        reason = activity_rejection(a, w, c)
        if reason:
            diag.reject(reason, a.id)
            continue
        opts[a.activity_key].append(a)
    if any(not v for v in opts.values()):
        return None
    return {k: sorted(v, key=lambda a: (a.date, a.id)) for k, v in opts.items()}


def plan_cost(items, pax: int) -> int:
    return sum(a.price_per_pax_minor * pax for a in items)


def solve_activities(
    stay: Stay,
    must_do: list[str],
    offers: list[ActivityOffer],
    weather: dict[tuple[str, object], WeatherDay],
    c: Constraints,
    pax: int,
    diag: Diagnostics,
) -> ActivityPlan | None:
    if not must_do:
        return ActivityPlan((), 0, True)
    opts = activity_options(stay, must_do, offers, weather, c, diag)
    if opts is None:
        return None

    m = cp_model.CpModel()
    x: dict[tuple[str, int], cp_model.IntVar] = {}
    slots_by_day, full_by_day = defaultdict(list), defaultdict(list)
    cost_terms, tie_terms = [], []
    for k, lst in opts.items():
        for i, a in enumerate(lst):
            v = m.new_bool_var(f"x_{k}_{i}")
            x[(k, i)] = v
            slots_by_day[a.date].append(a.slots * v)
            if a.slots == DAY_SLOTS:
                full_by_day[a.date].append(v)
            cost_terms.append(a.price_per_pax_minor * pax * v)
            w = weather.get((a.city, a.date))
            tie_terms.append(round(w.heavy_rain_prob * 1000) * v if w else 0)
        m.add_exactly_one(x[(k, i)] for i in range(len(lst)))
    for terms in slots_by_day.values():
        m.add(sum(terms) <= DAY_SLOTS)
    days = usable_days(stay, c)
    M = c.max_consecutive_full_days
    for s in range(len(days) - M):
        window = [v for d in days[s : s + M + 1] for v in full_by_day.get(d, [])]
        if window:
            m.add(sum(window) <= M)
    scale = 1000 * (len(must_do) + 1)
    m.minimize(scale * sum(cost_terms) + sum(tie_terms))

    solver = new_solver()
    status = solver.solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    chosen = sorted(
        (opts[k][i] for (k, i), v in x.items() if solver.value(v)), key=lambda a: (a.date, a.id)
    )
    return ActivityPlan(tuple(chosen), plan_cost(chosen, pax), status == cp_model.OPTIMAL)
```

**`engine/app/optimizer/oracle.py`**

```python
"""Oráculo de fuerza bruta: misma semántica que los modelos CP-SAT, enumerando TODO.

Uso exclusivo en tests y checkpoints (instancias chicas). Nunca en producción.
"""
from __future__ import annotations

from collections import Counter
from itertools import product

from app.domain.models import ActivityOffer, Constraints, LodgingOffer, WeatherDay
from app.optimizer.activities import DAY_SLOTS, ActivityPlan, activity_options, plan_cost
from app.optimizer.filters import Diagnostics
from app.optimizer.lodging import LodgingChoice, choice_cost, lodging_candidates
from app.optimizer.skeletons import Stay, usable_days


def solve_lodging_brute(
    stay: Stay, offers: list[LodgingOffer], c: Constraints, pax: int, diag: Diagnostics
) -> LodgingChoice | None:
    best: LodgingChoice | None = None
    for o in lodging_candidates(stay, offers, c, pax, diag):
        for combo in product(*(range(u.available + 1) for u in o.units)):
            cap = sum(q * u.capacity for q, u in zip(combo, o.units))
            bath = sum(q * u.bathrooms for q, u in zip(combo, o.units))
            bed = sum(q * u.bedrooms for q, u in zip(combo, o.units))
            if cap < pax or bath < c.min_bathrooms or bed < c.min_bedrooms:
                continue
            units = tuple((j, q) for j, q in enumerate(combo) if q > 0)
            cost = choice_cost(o, units)
            if best is None or (cost, o.id) < (best.cost_minor, best.offer.id):
                best = LodgingChoice(o, units, cost, True)
    return best


def max_run(days, full: Counter) -> int:
    run = best = 0
    for d in days:
        run = run + 1 if full[d] else 0
        best = max(best, run)
    return best


def solve_activities_brute(
    stay: Stay,
    must_do: list[str],
    offers: list[ActivityOffer],
    weather: dict[tuple[str, object], WeatherDay],
    c: Constraints,
    pax: int,
    diag: Diagnostics,
) -> ActivityPlan | None:
    if not must_do:
        return ActivityPlan((), 0, True)
    opts = activity_options(stay, must_do, offers, weather, c, diag)
    if opts is None:
        return None
    days = usable_days(stay, c)
    best: ActivityPlan | None = None
    for combo in product(*(opts[k] for k in must_do)):
        slots, full = Counter(), Counter()
        for a in combo:
            slots[a.date] += a.slots
            full[a.date] += a.slots == DAY_SLOTS
        if max(slots.values()) > DAY_SLOTS:
            continue
        if max_run(days, full) > c.max_consecutive_full_days:
            continue
        cost = plan_cost(combo, pax)
        if best is None or cost < best.cost_minor:
            items = tuple(sorted(combo, key=lambda a: (a.date, a.id)))
            best = ActivityPlan(items, cost, True)
    return best
```

**`engine/app/optimizer/solver.py`**

```python
"""Orquestador matemático: esqueletos -> subproblemas separables -> ranking exacto.

Dado un esqueleto, el costo total se separa en bloques independientes (vuelo por tramo;
alojamiento, actividades y transporte por estadía). Resolver cada bloque a optimalidad y
sumar da el ÓPTIMO GLOBAL exacto del modelo completo: es una descomposición, no una
heurística. Los bloques que se repiten entre esqueletos se resuelven una sola vez (memo).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from time import perf_counter
from typing import Literal

from app.domain.models import FlightOffer, OfferSet, TransportQuote, TripRequest
from app.optimizer.activities import ActivityPlan, solve_activities
from app.optimizer.filters import (
    Diagnostics,
    flight_cost,
    flight_rejection,
    leg_matches,
    transport_cost,
)
from app.optimizer.lodging import LodgingChoice, solve_lodging
from app.optimizer.skeletons import Leg, Skeleton, Stay, generate_skeletons

Engine = Literal["cpsat", "brute"]


@dataclass(frozen=True)
class ChosenFlight:
    leg_index: int
    offer: FlightOffer
    cost_minor: int


@dataclass(frozen=True)
class StayPlan:
    stay: Stay
    lodging: LodgingChoice
    activities: ActivityPlan
    transport: TransportQuote | None
    transport_cost_minor: int


@dataclass
class Itinerary:
    rank: int
    skeleton: Skeleton
    flights: list[ChosenFlight]
    stays: list[StayPlan]
    total_minor: int
    within_budget: bool


@dataclass
class OptimizationResult:
    status: Literal["ok", "over_budget", "infeasible"]
    itineraries: list[Itinerary]
    budget_gap_minor: int
    diagnostics: dict
    stats: dict


def best_flight(leg: Leg, flights: list[FlightOffer], c, pax: int, diag: Diagnostics):
    best = None
    for f in flights:
        if not leg_matches(f, leg):
            continue
        reason = flight_rejection(f, leg, c, pax)
        if reason:
            diag.reject(reason, f.id)
            continue
        key = (flight_cost(f, c, pax), f.depart_at, f.id)
        if best is None or key < best[0]:
            best = (key, f)
    return None if best is None else (best[1], best[0][0])


def optimize(req: TripRequest, offers: OfferSet, engine: Engine = "cpsat") -> OptimizationResult:
    from app.optimizer import oracle

    solve_l = solve_lodging if engine == "cpsat" else oracle.solve_lodging_brute
    solve_a = solve_activities if engine == "cpsat" else oracle.solve_activities_brute
    t0 = perf_counter()
    c, pax = req.constraints, req.pax
    diag = Diagnostics()
    weather = {(w.city, w.date): w for w in offers.weather}
    # Índices por clave de consulta: cada bloque recibe solo sus ofertas (mismo orden relativo que la lista original).
    flights_by_key: dict = defaultdict(dict)  # (origen, destino, fecha de salida) -> {posición: oferta}
    for pos, f in enumerate(offers.flights):
        flights_by_key[(f.origin, f.destination, f.depart_at.date())][pos] = f
    lodging_by_stay: dict = defaultdict(list)
    for o in offers.lodging:
        lodging_by_stay[(o.city, o.check_in, o.check_out)].append(o)
    activities_by_city: dict = defaultdict(list)
    for a in offers.activities:
        activities_by_city[a.city].append(a)
    transport: dict[str, TransportQuote] = {}
    for q in sorted(offers.transport, key=lambda q: q.id):
        transport.setdefault(q.city, q)
    must_do = {p.code: p.must_do for p in req.cities}

    skeletons = generate_skeletons(req)
    flight_memo: dict = {}
    lodging_memo: dict = {}
    act_memo: dict = {}
    feasible: list[Itinerary] = []
    for s in skeletons:
        reason = None
        flights: list[ChosenFlight] = []
        for i, leg in enumerate(s.legs):
            if leg not in flight_memo:
                found = {
                    pos: f
                    for o in leg.origin_airports
                    for d in leg.dest_airports
                    for day in leg.depart_dates
                    for pos, f in flights_by_key.get((o, d, day), {}).items()
                }
                flight_memo[leg] = best_flight(leg, [found[pos] for pos in sorted(found)], c, pax, diag)
            if flight_memo[leg] is None:
                reason = f"sin_vuelo:tramo_{i}"
                break
            offer, cost = flight_memo[leg]
            flights.append(ChosenFlight(i, offer, cost))
        plans: list[StayPlan] = []
        for st in s.stays if reason is None else ():
            if st not in lodging_memo:
                lodging_memo[st] = solve_l(st, lodging_by_stay.get((st.city, st.check_in, st.check_out), []), c, pax, diag)
            if lodging_memo[st] is None:
                reason = f"sin_alojamiento:{st.city}"
                break
            if st not in act_memo:
                act_memo[st] = solve_a(st, must_do[st.city], activities_by_city.get(st.city, []), weather, c, pax, diag)
            if act_memo[st] is None:
                reason = f"actividades_infactibles:{st.city}"
                break
            q = transport.get(st.city)
            if q is None:
                diag.warnings.add(f"sin_transporte:{st.city}")
            plans.append(
                StayPlan(st, lodging_memo[st], act_memo[st], q, transport_cost(q, st) if q else 0)
            )
        if reason:
            diag.infeasible_skeletons[s.id] = reason
            continue
        total = sum(f.cost_minor for f in flights) + sum(
            p.lodging.cost_minor + p.activities.cost_minor + p.transport_cost_minor for p in plans
        )
        feasible.append(Itinerary(0, s, flights, plans, total, total <= req.budget_minor))

    feasible.sort(key=lambda it: (it.total_minor, it.skeleton.id))
    top = feasible[: req.top_n]
    for rank, it in enumerate(top, start=1):
        it.rank = rank
    if not top:
        status, gap = "infeasible", 0
    elif top[0].within_budget:
        status, gap = "ok", 0
    else:
        status, gap = "over_budget", top[0].total_minor - req.budget_minor

    subproblems = [v for v in (*lodging_memo.values(), *act_memo.values()) if v is not None]
    stats = {
        "engine": engine,
        "skeletons_total": len(skeletons),
        "skeletons_feasible": len(feasible),
        "unique_legs": len(flight_memo),
        "unique_stays": len(lodging_memo),
        "all_subproblems_optimal": all(v.optimal for v in subproblems),
        "elapsed_ms": round((perf_counter() - t0) * 1000, 1),
    }
    return OptimizationResult(status, top, gap, diag.summary(), stats)
```

**`engine/app/optimizer/finance.py`**

```python
"""Calculadora financiera: desglose línea por línea, exacto al centavo.

Usa las MISMAS funciones de dinero que el solver; al final concilia contra el total del
itinerario y falla ruidosamente si difiere en 1 centavo.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.domain.models import TripRequest
from app.domain.money import apply_bps, split_evenly
from app.optimizer.filters import flight_extra_bags, transport_base
from app.optimizer.solver import Itinerary

Category = Literal["vuelos", "alojamiento", "actividades", "transporte"]


@dataclass(frozen=True)
class Line:
    category: Category
    description: str
    quantity: int
    unit_minor: int
    subtotal_minor: int
    tax_minor: int
    total_minor: int
    ref: str
    deeplink: str | None


@dataclass
class Breakdown:
    currency: str
    lines: list[Line]
    by_category: dict[str, int]
    total_minor: int
    per_pax_minor: list[int]


class ReconciliationError(AssertionError):
    pass


def _line(cat, desc, qty, unit, ref, link, tax_bps: int = 0) -> Line:
    sub = qty * unit
    tax = qty * apply_bps(unit, tax_bps)
    return Line(cat, desc, qty, unit, sub, tax, sub + tax, ref, link)


def build_breakdown(it: Itinerary, req: TripRequest) -> Breakdown:
    c, pax = req.constraints, req.pax
    lines: list[Line] = []
    for cf in it.flights:
        f = cf.offer
        route = f"{f.origin}→{f.destination} {f.depart_at:%d/%m %H:%M} · {f.carrier} · {f.stops} esc."
        lines.append(_line("vuelos", f"Tarifa {route}", pax, f.price_per_pax_minor, f.id, f.deeplink))
        extra = flight_extra_bags(f, c) * pax
        if extra and f.bag_fee_minor:
            lines.append(_line("vuelos", f"Valijas {route}", extra, f.bag_fee_minor, f.id, f.deeplink))

    for sp in it.stays:
        o, nights = sp.lodging.offer, sp.stay.nights

        def lodging_line(desc: str, qty: int, unit: int, o=o) -> Line:
            return _line("alojamiento", desc, qty, unit, o.id, o.deeplink, o.tax_bps)

        for j, qty in sp.lodging.units:
            u = o.units[j]
            lines.append(lodging_line(f"{o.name} · {u.unit_type} · {nights} noches", qty, u.base_total_minor))
            if u.fees_total_minor:
                lines.append(lodging_line(f"Resort/facility fee · {u.unit_type}", qty, u.fees_total_minor))
        if o.stay_fee_minor:
            lines.append(lodging_line(f"Limpieza / cargo por reserva · {o.name}", 1, o.stay_fee_minor))
        for a in sp.activities.items:
            lines.append(_line("actividades", f"{a.name} · {a.date:%d/%m}", pax, a.price_per_pax_minor, a.id, a.deeplink))
        if sp.transport:
            q = sp.transport
            base = transport_base(q, sp.stay)
            label = "Alquiler de auto" if q.mode == "car_rental" else "Traslados"
            lines.append(_line("transporte", f"{label} · {sp.stay.city}", 1, base, q.id, q.deeplink, q.tax_bps))

    by_category: dict[str, int] = {}
    for ln in lines:
        by_category[ln.category] = by_category.get(ln.category, 0) + ln.total_minor
    total = sum(ln.total_minor for ln in lines)
    if total != it.total_minor:
        raise ReconciliationError(f"desglose {total} != solver {it.total_minor}")
    return Breakdown(req.currency, lines, by_category, total, split_evenly(total, pax))
```

**`engine/app/optimizer/service.py`**

```python
"""Servicio de optimización: lee ofertas de la corrida, resuelve, concilia y persiste."""
from __future__ import annotations

import asyncio
from dataclasses import asdict

from app.optimizer.finance import Breakdown, build_breakdown
from app.optimizer.solver import Itinerary, optimize
from app.repo.base import Repository, RunRecord


def itinerary_to_dict(it: Itinerary, b: Breakdown, pax: int) -> dict:
    return {
        "rank": it.rank,
        "skeleton_id": it.skeleton.id,
        "order": list(it.skeleton.order),
        "first_checkin": it.skeleton.first_checkin.isoformat(),
        "nights": dict(zip(it.skeleton.order, it.skeleton.nights)),
        "total_minor": it.total_minor,
        "within_budget": it.within_budget,
        "currency": b.currency,
        "flights": [
            {"leg": f.leg_index, "cost_minor": f.cost_minor, "offer": f.offer.model_dump(mode="json")}
            for f in it.flights
        ],
        "stays": [
            {
                "city": sp.stay.city,
                "check_in": sp.stay.check_in.isoformat(),
                "check_out": sp.stay.check_out.isoformat(),
                "nights": sp.stay.nights,
                "lodging": {
                    "offer_id": sp.lodging.offer.id,
                    "name": sp.lodging.offer.name,
                    "deeplink": sp.lodging.offer.deeplink,
                    "cost_minor": sp.lodging.cost_minor,
                    "units": [
                        {**sp.lodging.offer.units[j].model_dump(mode="json"), "qty": q}
                        for j, q in sp.lodging.units
                    ],
                },
                "activities": [
                    {**a.model_dump(mode="json"), "cost_minor": a.price_per_pax_minor * pax}
                    for a in sp.activities.items
                ],
                "transport_cost_minor": sp.transport_cost_minor,
            }
            for sp in it.stays
        ],
        "breakdown": {
            "lines": [asdict(ln) for ln in b.lines],
            "by_category": b.by_category,
            "total_minor": b.total_minor,
            "per_pax_minor": b.per_pax_minor,
        },
    }


async def run_optimization(repo: Repository, run: RunRecord) -> dict:
    offers = await repo.load_offers(run.id)
    res = await asyncio.to_thread(optimize, run.request, offers, "cpsat")  # CPU-bound fuera del event loop
    rows = [itinerary_to_dict(it, build_breakdown(it, run.request), run.request.pax) for it in res.itineraries]
    await repo.save_itineraries(run.id, run.user_id, rows)
    summary = {
        **(run.summary or {}),
        "result_status": res.status,
        "best_total_minor": rows[0]["total_minor"] if rows else None,
        "budget_gap_minor": res.budget_gap_minor,
        "diagnostics": res.diagnostics,
        "stats": res.stats,
    }
    final = "done" if rows else "infeasible"
    await repo.transition(run.id, {"optimizing"}, final, summary=summary)
    return {"run_id": run.id, "status": final, **summary}
```

**`engine/app/cli.py`**

```python
"""CLI local: resuelve un caso fixture sin DB ni n8n.

    uv run python -m app.cli orlando_nyc_5pax [--engine brute]
"""
from __future__ import annotations

import argparse
import asyncio
import json

from app.domain.money import fmt
from app.optimizer.finance import build_breakdown
from app.optimizer.skeletons import build_query_plan, generate_skeletons
from app.optimizer.solver import optimize
from app.providers.base import collect_offers
from app.providers.fixture import FixtureProvider


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_key")
    ap.add_argument("--engine", choices=["cpsat", "brute"], default="cpsat")
    args = ap.parse_args()

    p = FixtureProvider(args.case_key)
    req = p.trip_request()
    plan = build_query_plan(req, generate_skeletons(req))
    offers = asyncio.run(collect_offers(plan, p))
    res = optimize(req, offers, engine=args.engine)

    print(f"estado: {res.status} | stats: {json.dumps(res.stats)}")
    print(f"consultas mínimas: {len(plan.flights)} vuelos, {len(plan.stays)} estadías, {len(plan.city_days)} ciudad-días")
    for it in res.itineraries:
        print(f"  #{it.rank} {it.skeleton.id:<28} {fmt(it.total_minor):>16}")
    if not res.itineraries:
        return
    best = res.itineraries[0]
    b = build_breakdown(best, req)
    print("\nDesglose del óptimo:")
    for ln in b.lines:
        print(f"  [{ln.category:<11}] {ln.description[:58]:<58} x{ln.quantity:<2} {fmt(ln.total_minor):>14}")
    for cat, v in b.by_category.items():
        print(f"  {cat:<12} {fmt(v):>16}")
    print(f"  {'TOTAL':<12} {fmt(b.total_minor):>16}   por persona: {[fmt(x) for x in b.per_pax_minor]}")
    print("\nDescartes:", json.dumps({k: len(v) for k, v in res.diagnostics["rejections"].items()}))
    print("Esqueletos infactibles:", res.diagnostics["infeasible_skeletons"])


if __name__ == "__main__":
    main()
```

## 3.5 Tests de la Fase 3

**`engine/tests/test_golden_case.py`**

```python
"""Checkpoint del caso hardcodeado Orlando + NYC (5 pax). Valores calculados a mano y por oráculo."""
from app.optimizer.finance import build_breakdown
from app.optimizer.solver import optimize


def test_optimum(req, offers):
    res = optimize(req, offers, engine="cpsat")
    best = res.itineraries[0]
    assert res.status == "ok"
    assert best.skeleton.id == "ORL-NYC|2027-07-08|8-4"
    assert best.total_minor == 2008362  # USD 20,083.62
    assert [it.total_minor for it in res.itineraries] == [2008362, 2042378, 2110878]
    assert [f.offer.id for f in best.flights] == ["F02", "F13", "F21"]
    orl, nyc = best.stays
    assert orl.lodging.offer.id.startswith("H2@")
    assert nyc.lodging.offer.id.startswith("N2@")
    assert nyc.lodging.units == ((0, 1), (1, 1))  # 1x "2 Queen" + 1x "Queen" = 6 plazas, 2 baños
    assert orl.activities.cost_minor == 455000
    assert nyc.activities.cost_minor == 53000
    assert res.stats["skeletons_total"] == 6
    assert res.stats["skeletons_feasible"] == 4
    assert res.stats["all_subproblems_optimal"] is True


def test_feasibility_funnel(req, offers):
    d = optimize(req, offers).diagnostics
    r = d["rejections"]
    assert r["flight.too_many_stops"] == ["F04"]
    assert r["flight.insufficient_seats"] == ["F05"]
    assert r["flight.departs_too_early"] == ["F14"]
    assert all(i.startswith("H3@") for i in r["lodging.bathrooms"])
    assert all(i.startswith("N3@") for i in r["lodging.short_term_not_legal"])
    assert all(i.startswith("H2@") for i in r["lodging.min_nights"])
    assert set(d["infeasible_skeletons"]) == {"ORL-NYC|2027-07-08|6-6", "ORL-NYC|2027-07-09|6-6"}
    assert set(d["infeasible_skeletons"].values()) == {"actividades_infactibles:ORL"}


def test_breakdown_reconciles(req, offers):
    best = optimize(req, offers).itineraries[0]
    b = build_breakdown(best, req)
    assert b.total_minor == best.total_minor
    assert b.by_category == {
        "vuelos": 1048500,
        "alojamiento": 355662,
        "actividades": 508000,
        "transporte": 96200,
    }
    assert b.per_pax_minor == [401673, 401673, 401672, 401672, 401672]
    assert sum(b.per_pax_minor) == b.total_minor


def test_weather_is_hard_constraint(req, offers):
    best = optimize(req, offers).itineraries[0]
    for sp in best.stays:
        for a in sp.activities.items:
            assert not (a.city == "ORL" and a.date.isoformat() == "2027-07-12")
            assert not (a.outdoor and a.city == "NYC" and a.date.isoformat() == "2027-07-18")
```

**`engine/tests/test_oracle_equivalence.py`**

```python
"""CP-SAT vs fuerza bruta: deben coincidir al centavo (caso fixture + instancias aleatorias)."""
import random
from datetime import date, timedelta

import pytest

from app.domain.models import ActivityOffer, Constraints, LodgingOffer, LodgingUnit, WeatherDay
from app.optimizer.activities import solve_activities
from app.optimizer.filters import Diagnostics
from app.optimizer.lodging import solve_lodging
from app.optimizer.oracle import solve_activities_brute, solve_lodging_brute
from app.optimizer.skeletons import Stay
from app.optimizer.solver import optimize


def _cost(x):
    return None if x is None else x.cost_minor


def test_full_case_cpsat_equals_brute(req, offers):
    a = optimize(req, offers, engine="cpsat")
    b = optimize(req, offers, engine="brute")
    assert [i.total_minor for i in a.itineraries] == [i.total_minor for i in b.itineraries]
    assert [i.skeleton.id for i in a.itineraries] == [i.skeleton.id for i in b.itineraries]
    assert a.diagnostics["infeasible_skeletons"] == b.diagnostics["infeasible_skeletons"]


def _random_lodging(rng: random.Random, stay: Stay) -> list[LodgingOffer]:
    offers = []
    for h in range(rng.randint(1, 4)):
        units = [
            LodgingUnit(
                unit_type=f"u{j}",
                capacity=rng.randint(1, 6),
                bedrooms=rng.randint(0, 3),
                bathrooms=rng.randint(0, 2),
                available=rng.randint(0, 3),
                base_total_minor=rng.randint(1, 900) * 100,
                fees_total_minor=rng.choice([0, 0, rng.randint(1, 99) * 100]),
            )
            for j in range(rng.randint(1, 3))
        ]
        offers.append(
            LodgingOffer(
                id=f"P{h}", provider="rnd", city=stay.city, name=f"P{h}",
                check_in=stay.check_in, check_out=stay.check_out, units=units,
                stay_fee_minor=rng.choice([0, rng.randint(1, 300) * 100]),
                tax_bps=rng.choice([0, 1250, 1350, 1475]),
            )
        )
    return offers


@pytest.mark.parametrize("seed", range(150))
def test_random_lodging(seed):
    rng = random.Random(seed)
    stay = Stay("X", date(2027, 1, 1), date(2027, 1, 1) + timedelta(days=rng.randint(1, 10)))
    c = Constraints(min_bathrooms=rng.randint(0, 3), min_bedrooms=rng.randint(0, 3))
    pax = rng.randint(1, 8)
    offers = _random_lodging(rng, stay)
    assert _cost(solve_lodging(stay, offers, c, pax, Diagnostics())) == _cost(
        solve_lodging_brute(stay, offers, c, pax, Diagnostics())
    )


@pytest.mark.parametrize("seed", range(150))
def test_random_activities(seed):
    rng = random.Random(seed)
    start = date(2027, 7, 1)
    stay = Stay("X", start, start + timedelta(days=rng.randint(2, 8)))
    keys = [f"k{i}" for i in range(rng.randint(1, 4))]
    slots = {k: rng.choice([1, 2]) for k in keys}
    outdoor = {k: rng.random() < 0.7 for k in keys}
    offers, weather = [], {}
    for i in range(stay.nights + 1):
        d = start + timedelta(days=i)
        weather[("X", d)] = WeatherDay(city="X", date=d, tmax_c=30, heavy_rain_prob=rng.random(), source="rnd")
        for k in keys:
            if rng.random() < 0.8:
                offers.append(
                    ActivityOffer(
                        id=f"{k}@{d}", provider="rnd", city="X", activity_key=k, name=k, date=d,
                        price_per_pax_minor=rng.randint(10, 300) * 100, outdoor=outdoor[k], slots=slots[k],
                    )
                )
    c = Constraints(
        max_heavy_rain_prob=rng.choice([0.3, 0.5, 0.8]),
        max_consecutive_full_days=rng.randint(1, 3),
        activity_free_travel_days=rng.random() < 0.5,
    )
    pax = rng.randint(1, 6)
    assert _cost(solve_activities(stay, keys, offers, weather, c, pax, Diagnostics())) == _cost(
        solve_activities_brute(stay, keys, offers, weather, c, pax, Diagnostics())
    )
```

**`engine/tests/test_variants.py`**

```python
"""Fase 3: sensibilidad a restricciones y determinismo (valores usados también en los e2e del frontend)."""
import pytest

from app.optimizer.solver import optimize


def _with(req, **changes):
    r = req.model_copy(deep=True)
    for path, value in changes.items():
        target = r
        *parents, leaf = path.split("__")
        for p in parents:
            target = getattr(target, p)
        setattr(target, leaf, value)
    return r


@pytest.mark.parametrize(
    "changes,status,best,gap",
    [
        ({}, "ok", 2008362, 0),
        ({"constraints__min_bathrooms": 3}, "over_budget", 2163638, 63638),
        ({"budget_minor": 2000000}, "over_budget", 2008362, 8362),
        ({"constraints__max_heavy_rain_prob": 0.6}, "ok", 2008362, 0),
        ({"constraints__max_stops": 0}, "infeasible", None, 0),
    ],
)
def test_constraint_variants(req, offers, changes, status, best, gap):
    res = optimize(_with(req, **changes), offers)
    assert res.status == status
    assert (res.itineraries[0].total_minor if res.itineraries else None) == best
    assert res.budget_gap_minor == gap


def test_rain_threshold_changes_runner_up(req, offers):
    res = optimize(_with(req, constraints__max_heavy_rain_prob=0.6), offers)
    assert res.itineraries[1].total_minor == 2032378  # 07-12 deja de estar vedado


def test_deterministic_schedule(req, offers):
    def schedule():
        best = optimize(req, offers).itineraries[0]
        return [(a.activity_key, a.date) for sp in best.stays for a in sp.activities.items]

    assert schedule() == schedule() == schedule()
```

**`engine/tests/test_api_optimize.py`**

```python
"""Fase 3: flujo completo por HTTP hasta 'done', verificado contra el golden."""
import asyncio
import json
from pathlib import Path

from tests.conftest import CASE, new_fixture_run

GOLDEN = json.loads((Path(__file__).parents[1] / "fixtures" / CASE / "expected.json").read_text(encoding="utf-8"))
KINDS = ["flights", "lodging", "activities", "weather", "transport"]


def test_full_flow_reaches_done_with_golden_total(api):
    async def go():
        rid = await new_fixture_run(api)
        await api.post(f"/v1/runs/{rid}/plan")
        await asyncio.gather(*(api.post(f"/v1/runs/{rid}/extract/{k}") for k in KINDS))
        opt = await api.post(f"/v1/runs/{rid}/optimize")
        assert opt.status_code == 200, opt.text
        run = (await api.get(f"/v1/runs/{rid}")).json()
        assert run["status"] == "done"
        assert set(run["timings"]) == {"queued", "extracting", "optimizing", "done"}
        its = run["itineraries"]
        assert [i["total_minor"] for i in its] == GOLDEN["top_totals_minor"]
        assert its[0]["skeleton_id"] == GOLDEN["best_skeleton_id"]
        assert sum(ln["total_minor"] for ln in its[0]["breakdown"]["lines"]) == GOLDEN["best_total_minor"]

    asyncio.run(go())


def test_optimize_twice_is_rejected(api):
    async def go():
        rid = await new_fixture_run(api)
        assert (await api.post(f"/v1/runs/{rid}/run-all")).status_code == 200
        assert (await api.post(f"/v1/runs/{rid}/optimize")).status_code == 409

    asyncio.run(go())
```

## 3.6 Salida esperada del CLI

Desde `engine/`:

```bash
uv run python -m app.cli orlando_nyc_5pax
```

**`docs_src/cli_output.txt`**

```
estado: ok | stats: {"engine": "cpsat", "skeletons_total": 6, "skeletons_feasible": 4, "unique_legs": 8, "unique_stays": 10, "all_subproblems_optimal": true, "elapsed_ms": 81.6}
consultas mínimas: 9 vuelos, 12 estadías, 14 ciudad-días
  #1 ORL-NYC|2027-07-08|8-4          USD 20,083.62
  #2 ORL-NYC|2027-07-08|7-5          USD 20,423.78
  #3 ORL-NYC|2027-07-09|7-5          USD 21,108.78

Desglose del óptimo:
  [vuelos     ] Tarifa EZE→MCO 08/07 09:00 · AA · 1 esc.                   x5    USD 4,450.00
  [vuelos     ] Valijas EZE→MCO 08/07 09:00 · AA · 1 esc.                  x5      USD 200.00
  [vuelos     ] Tarifa MCO→LGA 16/07 09:10 · DL · 0 esc.                   x5      USD 710.00
  [vuelos     ] Valijas MCO→LGA 16/07 09:10 · DL · 0 esc.                  x5      USD 175.00
  [vuelos     ] Tarifa EWR→EZE 20/07 18:00 · CM · 1 esc.                   x5    USD 4,950.00
  [alojamiento] Townhouse 3 dorm. Davenport · Casa completa · 8 noches     x1    USD 1,665.00
  [alojamiento] Limpieza / cargo por reserva · Townhouse 3 dorm. Davenport x1      USD 202.50
  [actividades] Epic Universe (1 día) · 09/07                              x5      USD 995.00
  [actividades] Animal Kingdom (1 día) · 10/07                             x5      USD 870.00
  [actividades] Hollywood Studios (1 día) · 13/07                          x5      USD 895.00
  [actividades] EPCOT (1 día) · 14/07                                      x5      USD 845.00
  [actividades] Magic Kingdom (1 día) · 15/07                              x5      USD 945.00
  [transporte ] Alquiler de auto · ORL                                     x1      USD 772.00
  [alojamiento] Hotel Long Island City · 2 Queen · 4 noches                x1      USD 913.41
  [alojamiento] Hotel Long Island City · Queen · 4 noches                  x1      USD 775.71
  [actividades] MoMA · 17/07                                               x5      USD 150.00
  [actividades] Estatua de la Libertad + Ellis Island · 19/07              x5      USD 155.00
  [actividades] Top of the Rock · 19/07                                    x5      USD 225.00
  [transporte ] Traslados · NYC                                            x1      USD 190.00
  vuelos          USD 10,485.00
  alojamiento      USD 3,556.62
  actividades      USD 5,080.00
  transporte         USD 962.00
  TOTAL           USD 20,083.62   por persona: ['USD 4,016.73', 'USD 4,016.73', 'USD 4,016.72', 'USD 4,016.72', 'USD 4,016.72']

Descartes: {"activity.weather_rain": 7, "flight.departs_too_early": 1, "flight.insufficient_seats": 1, "flight.too_many_stops": 1, "lodging.bathrooms": 6, "lodging.min_nights": 2, "lodging.short_term_not_legal": 4}
Esqueletos infactibles: {'ORL-NYC|2027-07-08|6-6': 'actividades_infactibles:ORL', 'ORL-NYC|2027-07-09|6-6': 'actividades_infactibles:ORL'}
```

`elapsed_ms` varía según la máquina: 81,6 ms en la de referencia. Con `--engine brute` el top-3 tiene que ser idéntico.

## 3.7 Verificación manual (planilla)

Replicar en Excel o Sheets. Todo es aritmética entera en centavos, con impuestos half-up **por línea**.

**Itinerario óptimo** (check-in 08/07, 8 noches ORL y 4 NYC, 5 pax):

| Línea | Cálculo | USD |
|---|---|---|
| Vuelo EZE→MCO F02 (sin valija incluida) | 5 × (890 + 40) | 4,650.00 |
| Vuelo MCO→LGA F13 (sin valija incluida) | 5 × (142 + 35) | 885.00 |
| Vuelo EWR→EZE F21 (con valija) | 5 × 990 | 4,950.00 |
| H2 Townhouse, 8 noches | 185 × 8 = 1,480.00 + 12,5 % (185.00) | 1,665.00 |
| H2 limpieza | 180.00 + 12,5 % (22.50) | 202.50 |
| N2 "2 Queen", 4 noches | 199 × 4 = 796.00 + 14,75 % (117.41) | 913.41 |
| N2 "Queen", 4 noches | 169 × 4 = 676.00 + 14,75 % (99.71) | 775.71 |
| Parques ORL | 5 × (EPIC 199 vie + AK 174 sáb + HS 179 + EPCOT 169 + MK 189) = 5 × 910 | 4,550.00 |
| Actividades NYC | 5 × (MoMA 30 + Estatua 31 + Top of the Rock 45) | 530.00 |
| Auto en Orlando | 89 × 8 + 60 | 772.00 |
| Traslados en NYC | 2 × 95 | 190.00 |
| **Total** | | **20,083.62** |

**Comparación de los 4 esqueletos factibles:**

| Esqueleto | Vuelos | Aloj. ORL | Aloj. NYC | Act. ORL | Act. NYC | Transp. | **Total** |
|---|---|---|---|---|---|---|---|
| 08/07 · 8-4 | 10,485.00 | 1,867.50 | 1,689.12 | 4,550.00 | 530.00 | 962.00 | **20,083.62** |
| 08/07 · 7-5 | 10,600.00 | 1,659.38 | 2,111.40 | 4,650.00 | 530.00 | 873.00 | **20,423.78** |
| 09/07 · 7-5 | 11,285.00 | 1,659.38 | 2,111.40 | 4,650.00 | 530.00 | 873.00 | **21,108.78** |
| 09/07 · 8-4 | 11,450.00 | 1,867.50 | 1,689.12 | 4,650.00 | 530.00 | 962.00 | **21,148.62** |

Los esqueletos de 6 noches en Orlando son infactibles. El 12/07 está vedado por lluvia (0,55 > 0,5), así que quedan 4 días útiles para 5 parques obligatorios.

---

## Checkpoints de validación (todos deben dar OK)

**Estado previo:** todo el código de esta fase se ejecutó. Hay 343 tests OK; el CLI produce la salida de §3.6; `run_fixture_inprocess` del devtools contra el motor real da `verdict: OK`. **No se ejecutaron**: la persistencia de itinerarios en Postgres (CP-3.10) y el E2E vía n8n (CP-3.9).

| ID | Check | Cómo | OK si… |
|---|---|---|---|
| CP-3.1 | Suite completa | En `engine/`: `uv run pytest -q` | `343 passed` |
| CP-3.2 | CLI = golden | `uv run python -m app.cli orlando_nyc_5pax` | Coincide con §3.6, salvo `elapsed_ms` |
| CP-3.3 | Oráculo | `uv run python -m app.cli orlando_nyc_5pax --engine brute` | El mismo top-3: 20,083.62 / 20,423.78 / 21,108.78 |
| CP-3.4 | Planilla manual | §3.7 en Excel | Total **20,083.62** y las 4 filas de la comparación |
| CP-3.5 | Variantes | Incluidas en `test_variants.py` | 3 baños → **21,636.38** (excede por 636.38) · presupuesto 20,000 → excede por **83.62** · lluvia 0,6 → el #2 pasa a **20,323.78** · 0 escalas → `infeasible` |
| CP-3.6 | Determinismo | `test_deterministic_schedule` | El mismo cronograma en 3 corridas |
| CP-3.7 | Rendimiento | `stats.elapsed_ms` del CLI | < 2000 ms |
| CP-3.8 | E2E sin n8n | Claude: `run_fixture_inprocess()` | `verdict: OK` (5 checks en `true`) |
| CP-3.9 | **E2E vía n8n** | Claude: `e2e_via_n8n()` | `verdict: OK`; `timings` con `queued`, `extracting`, `optimizing` y `done` |
| CP-3.10 | Persistencia | `supabase-local`: `select rank, total_minor, (payload->'breakdown'->>'total_minor')::bigint as bd from itineraries where run_id = '<id>' order by rank` | 3 filas: 2008362, 2042378 y 2110878, con `bd = total_minor` |
| CP-3.11 | Embudo persistido | `select summary->'diagnostics'->'infeasible_skeletons' from search_runs where id = '<id>'` | 2 claves (los esqueletos de 6 noches en ORL) |
| CP-3.12 | Gate | `uv run python scripts/gate.py 3` | `GATE FASE 3: OK` |

> Al cerrar: actualizar la tabla *Estado* de `master_plan.md` y hacer un commit `fase-3: gate OK`.
