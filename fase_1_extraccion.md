# Fase 1: extracción (contrato, base de datos, proveedores y API)

**Objetivo:** que el motor sepa *qué* consultar (plan mínimo), *cómo* consultarlo sin romper límites (caché, rate limit, reintentos) y *dónde* dejarlo (Supabase). También que exponga la API que n8n va a orquestar en la Fase 2.
**Requisito previo:** `GATE FASE 0: OK`.
**Salida:**
- esquema en Supabase con RLS probada;
- motor FastAPI en modos `fixture` y `hybrid` (clima real);
- 29 tests en verde;
- decisión documentada de proveedores live.

> En esta fase `POST /v1/runs/{id}/optimize` responde **501 `optimizer_not_ready`** a propósito: el optimizador llega en la Fase 3. El archivo `app/api/main.py` es el mismo en las dos fases y detecta solo si existe `app/optimizer/service.py`.

---

## 1.1 Base de datos

Seis tablas:
- `trip_requests`, `search_runs`, `itineraries`: el navegador las lee con RLS.
- `run_offers`, `api_cache`, `api_usage`: invisibles fuera del backend.

Solo el motor escribe. Por defensa en profundidad se revocan los privilegios de escritura de `anon` y `authenticated` además de activar RLS.

```bash
npx supabase migration new core_schema
```

Reemplazar el contenido del archivo generado por el siguiente. Si se copia tal cual con el mismo nombre, también funciona.

**`supabase/migrations/20261026000100_core_schema.sql`**

```sql
-- TravelOpt · esquema núcleo
-- Escritor único: el motor (rol postgres vía DATABASE_URL). El navegador solo LEE lo suyo (RLS).

create type public.run_status as enum ('queued', 'extracting', 'optimizing', 'done', 'infeasible', 'failed');
create type public.run_mode   as enum ('fixture', 'hybrid', 'live');

create table public.trip_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete cascade,
  case_key   text,
  payload    jsonb not null,                       -- TripRequest validado por Pydantic
  created_at timestamptz not null default now()
);

create table public.search_runs (
  id              uuid primary key default gen_random_uuid(),
  trip_request_id uuid not null references public.trip_requests (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete cascade,   -- desnormalizado: RLS y Realtime
  status          public.run_status not null default 'queued',
  mode            public.run_mode   not null default 'fixture',
  summary         jsonb not null default '{}'::jsonb,                  -- plan de consultas, embudo, stats
  error           jsonb,
  timings         jsonb not null default '{}'::jsonb,                  -- timestamp de entrada a cada estado
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index search_runs_user_idx   on public.search_runs (user_id, created_at desc);
create index search_runs_active_idx on public.search_runs (updated_at) where status in ('queued', 'extracting', 'optimizing');

create table public.run_offers (
  run_id     uuid not null references public.search_runs (id) on delete cascade,
  kind       text not null check (kind in ('flights', 'lodging', 'activities', 'weather', 'transport')),
  offer_id   text not null,
  provider   text not null,
  payload    jsonb not null,                       -- modelo canónico (FlightOffer, LodgingOffer, ...)
  created_at timestamptz not null default now(),
  primary key (run_id, kind, offer_id)             -- upsert idempotente ante reintentos de n8n
);

create table public.itineraries (
  run_id        uuid not null references public.search_runs (id) on delete cascade,
  rank          smallint not null check (rank >= 1),
  user_id       uuid references auth.users (id) on delete cascade,
  skeleton_id   text not null,
  total_minor   bigint not null check (total_minor >= 0),
  currency      char(3) not null default 'USD',
  within_budget boolean not null,
  payload       jsonb not null,                    -- itinerario + calculadora financiera
  created_at    timestamptz not null default now(),
  primary key (run_id, rank)
);

create table public.api_cache (
  cache_key  text primary key,                     -- sha256(proveedor|endpoint|params sin credenciales)
  provider   text not null,
  payload    jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz                           -- null = no expira (clima histórico)
);
create index api_cache_expiry_idx on public.api_cache (expires_at) where expires_at is not null;

create table public.api_usage (
  id          bigint generated always as identity primary key,
  provider    text not null,
  endpoint    text not null,
  status_code int,
  latency_ms  int,
  run_id      uuid,
  called_at   timestamptz not null default now()
);
create index api_usage_provider_idx on public.api_usage (provider, called_at desc);

-- updated_at automático (lo usa el "reaper" de corridas colgadas)
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger search_runs_touch before update on public.search_runs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- seguridad
alter table public.trip_requests enable row level security;
alter table public.search_runs   enable row level security;
alter table public.run_offers    enable row level security;
alter table public.itineraries   enable row level security;
alter table public.api_cache     enable row level security;
alter table public.api_usage     enable row level security;

-- Defensa en profundidad: además de RLS, el navegador no tiene privilegios de escritura.
revoke all on public.trip_requests, public.search_runs, public.run_offers,
              public.itineraries, public.api_cache, public.api_usage from anon, authenticated;
grant select on public.trip_requests, public.search_runs, public.itineraries to authenticated;

create policy "own trip requests" on public.trip_requests
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own runs" on public.search_runs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own itineraries" on public.itineraries
  for select to authenticated using (user_id = (select auth.uid()));
-- run_offers, api_cache, api_usage: sin políticas ni grants => invisibles fuera del backend.

-- Realtime: el frontend escucha cambios de estado de SU corrida (respeta RLS).
alter publication supabase_realtime add table public.search_runs;
```

**Pruebas de RLS (pgTAP):**

**`supabase/tests/database/rls.test.sql`**

```sql
-- pgTAP: aislamiento entre usuarios y superficie mínima para el navegador.
-- Ejecutar: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local');
insert into public.trip_requests (id, user_id, payload) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '{}');
insert into public.search_runs (id, trip_request_id, user_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into public.itineraries (run_id, rank, user_id, skeleton_id, total_minor, within_budget, payload) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 1, '11111111-1111-1111-1111-111111111111', 'x', 100, true, '{}');

-- Usuario B
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from public.search_runs), 0, 'B no ve corridas de A');
select is((select count(*)::int from public.itineraries), 0, 'B no ve itinerarios de A');

-- Usuario A
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is((select count(*)::int from public.search_runs), 1, 'A ve su corrida');
select is((select count(*)::int from public.itineraries), 1, 'A ve su itinerario');
select throws_ok(
  $$ update public.search_runs set status = 'done' $$,
  '42501', null, 'authenticated no puede modificar corridas');
select throws_ok(
  $$ select * from public.api_cache $$,
  '42501', null, 'api_cache no es accesible desde el navegador');
select throws_ok(
  $$ select * from public.run_offers $$,
  '42501', null, 'run_offers no es accesible desde el navegador');

-- Anónimo sin sesión (rol anon, no confundir con "anonymous sign-in", que es authenticated)
reset role;
set local role anon;
select throws_ok(
  $$ select * from public.search_runs $$,
  '42501', null, 'anon no tiene acceso a corridas');

select * from finish();
rollback;
```

```bash
npx supabase db reset
```

```bash
npx supabase test db
```

## 1.2 Proyecto del motor

```text
engine/
├── app/{domain,optimizer,providers,services,repo,api}/   (cada carpeta con __init__.py vacío)
├── app/settings.py · app/cli.py (Fase 3)
├── fixtures/orlando_nyc_5pax/
├── scripts/export_contracts.py
├── tests/  (con __init__.py vacío)
└── pyproject.toml
```

**`engine/pyproject.toml`**

```toml
[project]
name = "travelopt-engine"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.7",
  "pydantic-settings>=2.4",
  "httpx>=0.27",
  "psycopg[binary,pool]>=3.2",
  "ortools>=9.10",   # se usa desde la Fase 3 (CP-SAT); se instala desde el inicio
]

[dependency-groups]
dev = ["pytest>=8", "ruff>=0.6"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]

[tool.ruff]
line-length = 120
target-version = "py312"

[tool.ruff.lint]
select = ["E4", "E7", "E9", "F"]   # defaults previos a ruff 0.17, fijados para que una versión nueva no cambie el gate
```

```bash
cd engine
```

```bash
uv sync
```

`uv sync` crea `.venv` con Python 3.12 y genera `uv.lock`. Hay que commitear el lock: lo usa el Dockerfile de la Fase 5.

## 1.3 Contrato canónico

Todo proveedor, real o fixture, se normaliza a estas clases. El dinero es siempre `int` en centavos.

**`engine/app/domain/money.py`**

```python
"""Aritmética monetaria exacta.

Regla del proyecto: TODO monto es un int en unidades menores (centavos).
Nunca float para dinero. Las tasas se expresan en basis points (1 bp = 0,01 %).
"""
from __future__ import annotations

BPS = 10_000


def apply_bps(amount_minor: int, bps: int) -> int:
    """Devuelve amount * bps / 10000 redondeado half-up (montos y tasas >= 0)."""
    if amount_minor < 0 or bps < 0:
        raise ValueError("montos y tasas deben ser >= 0")
    return (amount_minor * bps + BPS // 2) // BPS


def with_tax(amount_minor: int, tax_bps: int) -> int:
    """Monto + impuesto, redondeando el impuesto por línea (política única del sistema)."""
    return amount_minor + apply_bps(amount_minor, tax_bps)


def split_evenly(total_minor: int, parts: int) -> list[int]:
    """Prorrateo exacto por el método del mayor resto: sum(resultado) == total_minor."""
    if parts <= 0:
        raise ValueError("parts debe ser > 0")
    base, rem = divmod(total_minor, parts)
    return [base + 1 if i < rem else base for i in range(parts)]


def fmt(amount_minor: int, currency: str = "USD") -> str:
    sign = "-" if amount_minor < 0 else ""
    a = abs(amount_minor)
    return f"{sign}{currency} {a // 100:,}.{a % 100:02d}"
```

**`engine/app/domain/models.py`**

```python
"""Modelo canónico. Todo proveedor (fixture o API real) se normaliza a estas clases.

Fuente única de verdad del contrato de datos: el frontend y n8n validan contra el
JSON Schema exportado desde aquí (ver scripts/export_contracts.py).
"""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

IATA = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
CASE_KEY_PATTERN = r"^[a-z0-9_]{1,64}$"
CaseKey = Annotated[str, StringConstraints(pattern=CASE_KEY_PATTERN)]


def _https(v: str | None) -> str | None:
    """Los deeplinks se renderizan como <a href>: solo https, con host y sin credenciales embebidas."""
    if v is None:
        return v
    u = urlparse(v)
    if u.scheme != "https" or not u.netloc or "@" in u.netloc:
        raise ValueError("deeplink debe ser una URL https sin credenciales")
    return v


Deeplink = Annotated[str | None, AfterValidator(_https)]

# ---------------------------------------------------------------- entrada


class Constraints(BaseModel):
    min_bathrooms: int = Field(2, ge=0)
    min_bedrooms: int = Field(0, ge=0)
    max_stops: int = Field(1, ge=0)
    earliest_departure_hour: int = Field(6, ge=0, le=23)
    latest_arrival_hour: int = Field(23, ge=0, le=23)
    checked_bags_per_pax: int = Field(1, ge=0)
    allow_overnight_outbound: bool = True
    max_heavy_rain_prob: float = Field(0.5, ge=0, le=1)  # solo actividades outdoor
    max_tmax_c: float = 38.0  # solo actividades outdoor
    max_consecutive_full_days: int = Field(3, ge=1)
    activity_free_travel_days: bool = True


class CityPlan(BaseModel):
    code: str = Field(pattern=r"^[A-Z]{2,5}$")  # "ORL", "NYC"
    airports: list[IATA] = Field(min_length=1, max_length=5)  # ["MCO"], ["JFK","LGA","EWR"]
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    min_nights: int = Field(ge=1, le=21)
    max_nights: int = Field(ge=1, le=21)
    # activity_key obligatorias en la ciudad
    must_do: list[Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,32}$")]] = Field([], max_length=10)

    @model_validator(mode="after")
    def _nights(self) -> "CityPlan":
        if self.max_nights < self.min_nights:
            raise ValueError(f"{self.code}: max_nights < min_nights")
        return self


class TripRequest(BaseModel):
    case_key: CaseKey | None = None
    origin_airports: list[IATA] = Field(min_length=1, max_length=5)
    cities: list[CityPlan] = Field(min_length=1, max_length=4)
    fixed_order: bool = True
    first_checkin_from: date
    first_checkin_to: date
    total_nights_min: int = Field(ge=1, le=60)
    total_nights_max: int = Field(ge=1, le=60)
    pax: int = Field(ge=1, le=9)
    budget_minor: int = Field(ge=0, le=10**10)
    currency: Literal["USD"] = "USD"
    constraints: Constraints = Constraints()
    top_n: int = Field(3, ge=1, le=10)

    @model_validator(mode="after")
    def _window(self) -> "TripRequest":
        if self.first_checkin_to < self.first_checkin_from:
            raise ValueError("first_checkin_to < first_checkin_from")
        if self.total_nights_max < self.total_nights_min:
            raise ValueError("total_nights_max < total_nights_min")
        days = (self.first_checkin_to - self.first_checkin_from).days + 1
        orders = 1 if self.fixed_order else math.factorial(len(self.cities))
        combos = days * orders * math.prod(c.max_nights - c.min_nights + 1 for c in self.cities)
        if days > 31 or combos > 20_000:
            raise ValueError("ventana de check-in o combinaciones de noches excesivas")
        return self


# ---------------------------------------------------------------- ofertas


class FlightOffer(BaseModel):
    kind: Literal["flight"] = "flight"
    id: str
    provider: str
    origin: str  # IATA aeropuerto
    destination: str
    depart_at: datetime  # hora LOCAL del aeropuerto de salida (naive)
    arrive_at: datetime  # hora LOCAL del aeropuerto de llegada (naive)
    stops: int = Field(ge=0)
    carrier: str
    price_per_pax_minor: int = Field(ge=0)  # tarifa final con impuestos
    included_bags: int = Field(0, ge=0)  # valijas despachadas incluidas por pax
    bag_fee_minor: int = Field(0, ge=0)  # por valija extra y por pax
    seats_available: int = Field(ge=0)
    deeplink: Deeplink = None


class LodgingUnit(BaseModel):
    unit_type: str
    capacity: int = Field(ge=1)
    bedrooms: int = Field(ge=0)
    bathrooms: int = Field(ge=0)  # baños completos
    bathrooms_source: Literal["explicit", "inferred_per_room"] = "explicit"
    available: int = Field(ge=0)
    base_total_minor: int = Field(ge=0)  # por unidad, estadía completa, sin impuestos
    fees_total_minor: int = Field(0, ge=0)  # resort/facility fee por unidad, estadía completa


class LodgingOffer(BaseModel):
    kind: Literal["lodging"] = "lodging"
    id: str
    provider: str
    city: str
    name: str
    check_in: date
    check_out: date
    units: list[LodgingUnit] = Field(min_length=1)
    stay_fee_minor: int = Field(0, ge=0)  # limpieza: una vez por reserva
    tax_bps: int = Field(0, ge=0)
    min_nights: int = Field(1, ge=1)
    short_term_legal: bool = True
    deeplink: Deeplink = None


class ActivityOffer(BaseModel):
    kind: Literal["activity"] = "activity"
    id: str
    provider: str
    city: str
    activity_key: str
    name: str
    date: date
    price_per_pax_minor: int = Field(ge=0)  # precio final
    outdoor: bool
    slots: int = Field(2, ge=1, le=2)  # 2 = día completo, 1 = medio día
    deeplink: Deeplink = None


class WeatherDay(BaseModel):
    city: str
    date: date
    tmax_c: float
    heavy_rain_prob: float = Field(ge=0, le=1)  # P(precipitación >= 10 mm)
    source: str


class TransportQuote(BaseModel):
    kind: Literal["transport"] = "transport"
    id: str
    provider: str
    city: str
    mode: Literal["car_rental", "transfers"]
    per_day_minor: int = 0  # se multiplica por noches de la estadía
    per_trip_minor: int = 0
    trips: int = 0
    fixed_minor: int = 0
    tax_bps: int = 0
    deeplink: Deeplink = None


class OfferSet(BaseModel):
    flights: list[FlightOffer] = []
    lodging: list[LodgingOffer] = []
    activities: list[ActivityOffer] = []
    weather: list[WeatherDay] = []
    transport: list[TransportQuote] = []
```

Exportar el contrato a JSON Schema, que consume el frontend en su test de contrato:

**`engine/scripts/export_contracts.py`**

```python
"""Exporta el contrato canónico a JSON Schema (lo consumen el frontend y los tests de contrato).

    uv run python -m scripts.export_contracts
"""
import json
from pathlib import Path

from app.domain.models import OfferSet, TripRequest

OUT = Path(__file__).resolve().parents[2] / "contracts"

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for model in (TripRequest, OfferSet):
        path = OUT / f"{model.__name__}.schema.json"
        path.write_text(json.dumps(model.model_json_schema(), indent=2, ensure_ascii=False), encoding="utf-8")
        print("escrito", path)
```

```bash
uv run python -m scripts.export_contracts
```

## 1.4 Planificador de consultas

Enumera los **esqueletos** del viaje: orden de ciudades × fecha del primer check-in × reparto de noches. Deriva los tramos y las estadías de cada uno, y calcula el **conjunto mínimo y deduplicado** de consultas externas. Permite vuelos de ida nocturnos: salida el día anterior y llegada el día del check-in.

**`engine/app/optimizer/skeletons.py`**

```python
"""Etapa 1 del motor: enumeración exhaustiva de esqueletos y plan mínimo de consultas.

Un esqueleto fija: orden de ciudades, fecha del primer check-in y noches por ciudad.
Con eso quedan determinados los tramos aéreos (Leg) y las estadías (Stay).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from itertools import permutations, product

from app.domain.models import Constraints, TripRequest


@dataclass(frozen=True)
class Stay:
    city: str
    check_in: date
    check_out: date

    @property
    def nights(self) -> int:
        return (self.check_out - self.check_in).days


@dataclass(frozen=True)
class Leg:
    origin_airports: tuple[str, ...]
    dest_airports: tuple[str, ...]
    depart_dates: tuple[date, ...]  # fechas de salida admitidas
    arrive_on: date | None  # debe llegar ese día (check-in); None = regreso a casa


@dataclass(frozen=True)
class Skeleton:
    id: str
    order: tuple[str, ...]
    first_checkin: date
    nights: tuple[int, ...]
    legs: tuple[Leg, ...]
    stays: tuple[Stay, ...]


@dataclass(frozen=True)
class FlightQuery:
    origins: tuple[str, ...]
    destinations: tuple[str, ...]
    date: date


@dataclass(frozen=True)
class QueryPlan:
    flights: tuple[FlightQuery, ...]
    stays: tuple[Stay, ...]
    city_days: tuple[tuple[str, date], ...]  # para actividades y clima
    cities: tuple[str, ...]


def _days(a: date, b: date):
    for i in range((b - a).days + 1):
        yield a + timedelta(days=i)


def usable_days(stay: Stay, c: Constraints) -> list[date]:
    """Días calendario de la estadía en los que se pueden programar actividades."""
    if c.activity_free_travel_days:
        return [stay.check_in + timedelta(days=i) for i in range(1, stay.nights)]
    return [stay.check_in + timedelta(days=i) for i in range(stay.nights + 1)]


def generate_skeletons(req: TripRequest) -> list[Skeleton]:
    by_code = {c.code: c for c in req.cities}
    orders = [tuple(by_code)] if req.fixed_order else list(permutations(by_code))
    home = tuple(req.origin_airports)
    out: list[Skeleton] = []
    for start in _days(req.first_checkin_from, req.first_checkin_to):
        for order in orders:
            plans = [by_code[code] for code in order]
            for nights in product(*(range(p.min_nights, p.max_nights + 1) for p in plans)):
                if not req.total_nights_min <= sum(nights) <= req.total_nights_max:
                    continue
                stays: list[Stay] = []
                cursor = start
                for p, n in zip(plans, nights):
                    stays.append(Stay(p.code, cursor, cursor + timedelta(days=n)))
                    cursor += timedelta(days=n)
                first = stays[0]
                outbound_dates = (
                    (first.check_in - timedelta(days=1), first.check_in)
                    if req.constraints.allow_overnight_outbound
                    else (first.check_in,)
                )
                legs = [Leg(home, tuple(plans[0].airports), outbound_dates, first.check_in)]
                for i in range(1, len(stays)):
                    legs.append(
                        Leg(
                            tuple(plans[i - 1].airports),
                            tuple(plans[i].airports),
                            (stays[i].check_in,),
                            stays[i].check_in,
                        )
                    )
                legs.append(Leg(tuple(plans[-1].airports), home, (stays[-1].check_out,), None))
                sid = f"{'-'.join(order)}|{start.isoformat()}|{'-'.join(map(str, nights))}"
                out.append(Skeleton(sid, order, start, nights, tuple(legs), tuple(stays)))
    return out


def build_query_plan(req: TripRequest, skeletons: list[Skeleton]) -> QueryPlan:
    """Conjunto MÍNIMO de consultas externas que cubre todos los esqueletos (deduplicado)."""
    flights = {
        FlightQuery(leg.origin_airports, leg.dest_airports, d)
        for s in skeletons
        for leg in s.legs
        for d in leg.depart_dates
    }
    stays = {st for s in skeletons for st in s.stays}
    city_days = {(st.city, d) for st in stays for d in usable_days(st, req.constraints)}
    return QueryPlan(
        flights=tuple(sorted(flights, key=lambda q: (q.date, q.origins, q.destinations))),
        stays=tuple(sorted(stays, key=lambda st: (st.city, st.check_in, st.check_out))),
        city_days=tuple(sorted(city_days)),
        cities=tuple(c.code for c in req.cities),
    )


@lru_cache(maxsize=32)
def _plan_for_json(request_json: str) -> QueryPlan:
    req = TripRequest.model_validate_json(request_json)
    return build_query_plan(req, generate_skeletons(req))


def plan_for(req: TripRequest) -> QueryPlan:
    """Plan de consultas de una solicitud, cacheado (el plan depende solo de la solicitud y es inmutable)."""
    return _plan_for_json(req.model_dump_json())
```

## 1.5 Proveedores (patrón Adapter)

**`engine/app/providers/base.py`**

```python
"""Contrato común de proveedores (patrón Adapter).

Cada fuente externa (fixture, Duffel, OpenWeather, etc.) implementa los métodos de su categoría y
devuelve modelos canónicos. El motor nunca ve JSON crudo de un proveedor. El registry asigna un
proveedor por categoría, así que una clase puede cubrir solo algunas (p. ej. el clima real).
"""
from __future__ import annotations

import asyncio
from datetime import date
from typing import Protocol

from app.domain.models import (
    ActivityOffer,
    FlightOffer,
    LodgingOffer,
    OfferSet,
    TransportQuote,
    WeatherDay,
)
from app.optimizer.skeletons import FlightQuery, QueryPlan, Stay

# categoría -> atributo del QueryPlan que se le pasa al método homónimo del proveedor
_PLAN_FIELD = {"flights": "flights", "lodging": "stays", "activities": "city_days",
               "weather": "city_days", "transport": "cities"}
KINDS = tuple(_PLAN_FIELD)


class Provider(Protocol):
    name: str

    async def flights(self, queries: list[FlightQuery]) -> list[FlightOffer]: ...

    async def lodging(self, stays: list[Stay]) -> list[LodgingOffer]: ...

    async def activities(self, city_days: list[tuple[str, date]]) -> list[ActivityOffer]: ...

    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]: ...

    async def transport(self, cities: list[str]) -> list[TransportQuote]: ...


async def fetch(provider: object, kind: str, plan: QueryPlan) -> list:
    """Pide a `provider` las ofertas de una categoría usando la parte del plan que le corresponde."""
    return await getattr(provider, kind)(list(getattr(plan, _PLAN_FIELD[kind])))


async def collect_offers(plan: QueryPlan, provider: Provider) -> OfferSet:
    """Fan-out concurrente en proceso (útil para tests y modo local sin n8n)."""
    results = await asyncio.gather(*(fetch(provider, k, plan) for k in KINDS))
    return OfferSet(**dict(zip(KINDS, results)))
```

### Caso de prueba hardcodeado `orlando_nyc_5pax`

Está diseñado para que **cada restricción se ejercite** y el óptimo sea verificable a mano.

| Elemento | Qué prueba |
|---|---|
| F01/F02 (ida 07-08) | El nocturno incluye valija; el diurno no. El costo efectivo incluye valijas (930 contra 980) |
| F04 / F05 / F14 | Se descartan por 2 escalas, por 3 asientos para 5 personas y por salir a las 05:30 |
| H2 (`min_nights: 7`) | Infactible para estadías de 6 noches |
| H3 (1 baño) | La más barata, pero viola "mínimo 2 baños" |
| H4 / N1 / N2 (hoteles) | Cobertura con varias habitaciones (2 Queen + Queen = 6 plazas y 2 baños, con `bathrooms_source = inferred_per_room`) |
| N3 (`short_term_legal: false`) | NYC Local Law 18 |
| EPIC cerrado el 15/07, recargo de fin de semana | Precios por fecha y disponibilidad |
| Lluvia en ORL el 12/07 y en NYC el 18/07 | Veda climática para actividades outdoor |

**`engine/fixtures/orlando_nyc_5pax/trip_request.json`**

```json
{
  "case_key": "orlando_nyc_5pax",
  "origin_airports": ["EZE"],
  "cities": [
    {
      "code": "ORL", "airports": ["MCO"], "lat": 28.3852, "lon": -81.5639,
      "min_nights": 6, "max_nights": 8,
      "must_do": ["MK", "EPCOT", "HS", "AK", "EPIC"]
    },
    {
      "code": "NYC", "airports": ["JFK", "LGA", "EWR"], "lat": 40.7580, "lon": -73.9855,
      "min_nights": 4, "max_nights": 6,
      "must_do": ["SOL", "TOR", "MOMA"]
    }
  ],
  "fixed_order": true,
  "first_checkin_from": "2027-07-08",
  "first_checkin_to": "2027-07-09",
  "total_nights_min": 12,
  "total_nights_max": 12,
  "pax": 5,
  "budget_minor": 2100000,
  "currency": "USD",
  "constraints": {
    "min_bathrooms": 2,
    "min_bedrooms": 0,
    "max_stops": 1,
    "earliest_departure_hour": 6,
    "latest_arrival_hour": 23,
    "checked_bags_per_pax": 1,
    "allow_overnight_outbound": true,
    "max_heavy_rain_prob": 0.5,
    "max_tmax_c": 38.0,
    "max_consecutive_full_days": 3,
    "activity_free_travel_days": true
  },
  "top_n": 3
}
```

**`engine/fixtures/orlando_nyc_5pax/flights.json`**

```json
[
  {"id": "F01", "provider": "fixture", "origin": "EZE", "destination": "MCO", "depart_at": "2027-07-07T22:30", "arrive_at": "2027-07-08T07:10", "stops": 1, "carrier": "CM", "price_per_pax_minor": 98000, "included_bags": 1, "bag_fee_minor": 0, "seats_available": 9, "deeplink": "https://www.google.com/travel/flights?q=Flights%20from%20EZE%20to%20MCO%20on%202027-07-07"},
  {"id": "F02", "provider": "fixture", "origin": "EZE", "destination": "MCO", "depart_at": "2027-07-08T09:00", "arrive_at": "2027-07-08T21:40", "stops": 1, "carrier": "AA", "price_per_pax_minor": 89000, "included_bags": 0, "bag_fee_minor": 4000, "seats_available": 9, "deeplink": "https://www.google.com/travel/flights?q=Flights%20from%20EZE%20to%20MCO%20on%202027-07-08"},
  {"id": "F03", "provider": "fixture", "origin": "EZE", "destination": "MCO", "depart_at": "2027-07-08T22:30", "arrive_at": "2027-07-09T07:10", "stops": 1, "carrier": "CM", "price_per_pax_minor": 102000, "included_bags": 1, "bag_fee_minor": 0, "seats_available": 9, "deeplink": "https://www.google.com/travel/flights?q=Flights%20from%20EZE%20to%20MCO%20on%202027-07-08"},
  {"id": "F04", "provider": "fixture", "origin": "EZE", "destination": "MCO", "depart_at": "2027-07-09T06:00", "arrive_at": "2027-07-09T20:15", "stops": 2, "carrier": "AV", "price_per_pax_minor": 76000, "included_bags": 1, "bag_fee_minor": 0, "seats_available": 9, "deeplink": null},
  {"id": "F05", "provider": "fixture", "origin": "EZE", "destination": "MCO", "depart_at": "2027-07-09T10:15", "arrive_at": "2027-07-09T19:30", "stops": 1, "carrier": "CM", "price_per_pax_minor": 94000, "included_bags": 1, "bag_fee_minor": 0, "seats_available": 3, "deeplink": null},

  {"id": "F10", "provider": "fixture", "origin": "MCO", "destination": "LGA", "depart_at": "2027-07-14T08:00", "arrive_at": "2027-07-14T10:35", "stops": 0, "carrier": "DL", "price_per_pax_minor": 18900, "included_bags": 0, "bag_fee_minor": 3500, "seats_available": 9, "deeplink": null},
  {"id": "F11", "provider": "fixture", "origin": "MCO", "destination": "JFK", "depart_at": "2027-07-15T07:30", "arrive_at": "2027-07-15T10:05", "stops": 0, "carrier": "B6", "price_per_pax_minor": 16500, "included_bags": 0, "bag_fee_minor": 3500, "seats_available": 9, "deeplink": null},
  {"id": "F12", "provider": "fixture", "origin": "MCO", "destination": "EWR", "depart_at": "2027-07-15T14:00", "arrive_at": "2027-07-15T16:30", "stops": 0, "carrier": "UA", "price_per_pax_minor": 21000, "included_bags": 1, "bag_fee_minor": 0, "seats_available": 9, "deeplink": null},
  {"id": "F13", "provider": "fixture", "origin": "MCO", "destination": "LGA", "depart_at": "2027-07-16T09:10", "arrive_at": "2027-07-16T11:45", "stops": 0, "carrier": "DL", "price_per_pax_minor": 14200, "included_bags": 0, "bag_fee_minor": 3500, "seats_available": 9, "deeplink": "https://www.google.com/travel/flights?q=Flights%20from%20MCO%20to%20LGA%20on%202027-07-16"},
  {"id": "F14", "provider": "fixture", "origin": "MCO", "destination": "JFK", "depart_at": "2027-07-16T05:30", "arrive_at": "2027-07-16T08:05", "stops": 0, "carrier": "B6", "price_per_pax_minor": 9900, "included_bags": 0, "bag_fee_minor": 3500, "seats_available": 9, "deeplink": null},
  {"id": "F15", "provider": "fixture", "origin": "MCO", "destination": "JFK", "depart_at": "2027-07-17T11:00", "arrive_at": "2027-07-17T13:40", "stops": 0, "carrier": "B6", "price_per_pax_minor": 17500, "included_bags": 0, "bag_fee_minor": 3500, "seats_available": 9, "deeplink": null},

  {"id": "F20", "provider": "fixture", "origin": "JFK", "destination": "EZE", "depart_at": "2027-07-20T21:15", "arrive_at": "2027-07-21T09:40", "stops": 0, "carrier": "AR", "price_per_pax_minor": 105000, "included_bags": 1, "bag_fee_minor": 0, "seats_available": 9, "deeplink": null},
  {"id": "F21", "provider": "fixture", "origin": "EWR", "destination": "EZE", "depart_at": "2027-07-20T18:00", "arrive_at": "2027-07-21T11:30", "stops": 1, "carrier": "CM", "price_per_pax_minor": 99000, "included_bags": 1, "bag_fee_minor": 0, "seats_available": 9, "deeplink": "https://www.google.com/travel/flights?q=Flights%20from%20EWR%20to%20EZE%20on%202027-07-20"},
  {"id": "F22", "provider": "fixture", "origin": "JFK", "destination": "EZE", "depart_at": "2027-07-21T21:15", "arrive_at": "2027-07-22T09:40", "stops": 0, "carrier": "AR", "price_per_pax_minor": 111000, "included_bags": 1, "bag_fee_minor": 0, "seats_available": 9, "deeplink": null},
  {"id": "F23", "provider": "fixture", "origin": "EWR", "destination": "EZE", "depart_at": "2027-07-21T18:00", "arrive_at": "2027-07-22T11:30", "stops": 1, "carrier": "CM", "price_per_pax_minor": 106000, "included_bags": 1, "bag_fee_minor": 0, "seats_available": 9, "deeplink": null}
]
```

**`engine/fixtures/orlando_nyc_5pax/lodging.json`**

```json
[
  {"id": "H1", "city": "ORL", "name": "Villa 4 dorm. Kissimmee", "tax_bps": 1350, "stay_fee_minor": 25000, "min_nights": 5, "short_term_legal": true, "deeplink": "https://example.com/fixture/H1",
   "units": [{"unit_type": "Casa completa", "capacity": 10, "bedrooms": 4, "bathrooms": 3, "available": 1, "nightly_minor": 26000}]},
  {"id": "H2", "city": "ORL", "name": "Townhouse 3 dorm. Davenport", "tax_bps": 1250, "stay_fee_minor": 18000, "min_nights": 7, "short_term_legal": true, "deeplink": "https://example.com/fixture/H2",
   "units": [{"unit_type": "Casa completa", "capacity": 8, "bedrooms": 3, "bathrooms": 2, "available": 1, "nightly_minor": 18500}]},
  {"id": "H3", "city": "ORL", "name": "Condo 2 dorm. (1 baño) Lake Buena Vista", "tax_bps": 1250, "stay_fee_minor": 12000, "min_nights": 3, "short_term_legal": true, "deeplink": "https://example.com/fixture/H3",
   "units": [{"unit_type": "Condo completo", "capacity": 6, "bedrooms": 2, "bathrooms": 1, "available": 1, "nightly_minor": 12000}]},
  {"id": "H4", "city": "ORL", "name": "Hotel Resort Lake Buena Vista", "tax_bps": 1250, "stay_fee_minor": 0, "min_nights": 1, "short_term_legal": true, "deeplink": "https://example.com/fixture/H4",
   "units": [
     {"unit_type": "2 Queen", "capacity": 4, "bedrooms": 1, "bathrooms": 1, "bathrooms_source": "inferred_per_room", "available": 5, "nightly_minor": 15900, "per_night_fee_minor": 3500},
     {"unit_type": "King", "capacity": 2, "bedrooms": 1, "bathrooms": 1, "bathrooms_source": "inferred_per_room", "available": 5, "nightly_minor": 13900, "per_night_fee_minor": 3500},
     {"unit_type": "Family Suite", "capacity": 6, "bedrooms": 2, "bathrooms": 1, "available": 2, "nightly_minor": 28900, "per_night_fee_minor": 3500}
   ]},

  {"id": "N1", "city": "NYC", "name": "Hotel Midtown", "tax_bps": 1475, "stay_fee_minor": 0, "min_nights": 1, "short_term_legal": true, "deeplink": "https://example.com/fixture/N1",
   "units": [
     {"unit_type": "2 Queen", "capacity": 4, "bedrooms": 1, "bathrooms": 1, "bathrooms_source": "inferred_per_room", "available": 3, "nightly_minor": 28900, "per_night_fee_minor": 3000},
     {"unit_type": "King", "capacity": 2, "bedrooms": 1, "bathrooms": 1, "bathrooms_source": "inferred_per_room", "available": 3, "nightly_minor": 24900, "per_night_fee_minor": 3000}
   ]},
  {"id": "N2", "city": "NYC", "name": "Hotel Long Island City", "tax_bps": 1475, "stay_fee_minor": 0, "min_nights": 1, "short_term_legal": true, "deeplink": "https://example.com/fixture/N2",
   "units": [
     {"unit_type": "2 Queen", "capacity": 4, "bedrooms": 1, "bathrooms": 1, "bathrooms_source": "inferred_per_room", "available": 2, "nightly_minor": 19900},
     {"unit_type": "Queen", "capacity": 2, "bedrooms": 1, "bathrooms": 1, "bathrooms_source": "inferred_per_room", "available": 2, "nightly_minor": 16900}
   ]},
  {"id": "N3", "city": "NYC", "name": "Depto. 3 dorm. Brooklyn (alquiler temporario)", "tax_bps": 1475, "stay_fee_minor": 20000, "min_nights": 2, "short_term_legal": false, "deeplink": "https://example.com/fixture/N3",
   "units": [{"unit_type": "Depto. completo", "capacity": 6, "bedrooms": 3, "bathrooms": 2, "available": 1, "nightly_minor": 35000}]},
  {"id": "N4", "city": "NYC", "name": "Suite Hotel Times Square", "tax_bps": 1475, "stay_fee_minor": 0, "min_nights": 1, "short_term_legal": true, "deeplink": "https://example.com/fixture/N4",
   "units": [{"unit_type": "Suite 2 dorm.", "capacity": 6, "bedrooms": 2, "bathrooms": 2, "available": 2, "nightly_minor": 52000, "per_night_fee_minor": 3000}]}
]
```

**`engine/fixtures/orlando_nyc_5pax/activities.json`**

```json
[
  {"key": "MK",    "city": "ORL", "name": "Magic Kingdom (1 día)",    "outdoor": true,  "slots": 2, "base_minor": 18900, "weekend_premium_minor": 2000, "closed_dates": [], "deeplink": "https://disneyworld.disney.go.com/"},
  {"key": "EPCOT", "city": "ORL", "name": "EPCOT (1 día)",            "outdoor": true,  "slots": 2, "base_minor": 16900, "weekend_premium_minor": 2000, "closed_dates": [], "deeplink": "https://disneyworld.disney.go.com/"},
  {"key": "HS",    "city": "ORL", "name": "Hollywood Studios (1 día)", "outdoor": true,  "slots": 2, "base_minor": 17900, "weekend_premium_minor": 2000, "closed_dates": [], "deeplink": "https://disneyworld.disney.go.com/"},
  {"key": "AK",    "city": "ORL", "name": "Animal Kingdom (1 día)",   "outdoor": true,  "slots": 2, "base_minor": 15900, "weekend_premium_minor": 1500, "closed_dates": [], "deeplink": "https://disneyworld.disney.go.com/"},
  {"key": "EPIC",  "city": "ORL", "name": "Epic Universe (1 día)",    "outdoor": true,  "slots": 2, "base_minor": 19900, "weekend_premium_minor": 2500, "closed_dates": ["2027-07-15"], "deeplink": "https://www.universalorlando.com/"},
  {"key": "SOL",   "city": "NYC", "name": "Estatua de la Libertad + Ellis Island", "outdoor": true, "slots": 1, "base_minor": 3100, "weekend_premium_minor": 0, "closed_dates": [], "deeplink": "https://www.nps.gov/stli/"},
  {"key": "TOR",   "city": "NYC", "name": "Top of the Rock",          "outdoor": true,  "slots": 1, "base_minor": 4500, "weekend_premium_minor": 500, "closed_dates": [], "deeplink": "https://www.rockefellercenter.com/"},
  {"key": "MOMA",  "city": "NYC", "name": "MoMA",                     "outdoor": false, "slots": 1, "base_minor": 3000, "weekend_premium_minor": 0, "closed_dates": [], "deeplink": "https://www.moma.org/"}
]
```

**`engine/fixtures/orlando_nyc_5pax/weather.json`**

```json
{
  "ORL": {
    "source": "fixture_climatology",
    "default": {"tmax_c": 33.5, "heavy_rain_prob": 0.30},
    "overrides": {"2027-07-12": {"heavy_rain_prob": 0.55}}
  },
  "NYC": {
    "source": "fixture_climatology",
    "default": {"tmax_c": 30.0, "heavy_rain_prob": 0.20},
    "overrides": {"2027-07-18": {"heavy_rain_prob": 0.60}}
  }
}
```

**`engine/fixtures/orlando_nyc_5pax/transport.json`**

```json
[
  {"id": "T-ORL", "provider": "fixture", "city": "ORL", "mode": "car_rental", "per_day_minor": 8900, "fixed_minor": 6000, "tax_bps": 0, "deeplink": "https://example.com/fixture/T-ORL"},
  {"id": "T-NYC", "provider": "fixture", "city": "NYC", "mode": "transfers", "per_trip_minor": 9500, "trips": 2, "tax_bps": 0, "deeplink": "https://example.com/fixture/T-NYC"}
]
```

**`engine/fixtures/orlando_nyc_5pax/expected.json`**

```json
{
  "best_total_minor": 2008362,
  "best_skeleton_id": "ORL-NYC|2027-07-08|8-4",
  "top_totals_minor": [2008362, 2042378, 2110878]
}
```

> `expected.json` es el **golden**. Los valores se calcularon a mano y se confirmaron con CP-SAT y con fuerza bruta (Fase 3). Solo se modifica con una decisión explícita, en el mismo commit que la causa.

**`engine/app/providers/fixture.py`**

```python
"""Proveedor fixture: materializa ofertas canónicas del caso de prueba hardcodeado.

Implementa las cinco interfaces de providers/base.py, así el resto del sistema no distingue
entre datos de prueba y datos en vivo. Los archivos viven en engine/fixtures/<case_key>/.
"""
from __future__ import annotations

import json
import re
from datetime import date
from functools import lru_cache
from pathlib import Path

from app.domain.models import (
    CASE_KEY_PATTERN,
    ActivityOffer,
    FlightOffer,
    LodgingOffer,
    LodgingUnit,
    TransportQuote,
    TripRequest,
    WeatherDay,
)
from app.optimizer.skeletons import FlightQuery, Stay

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"


class FixtureProvider:
    name = "fixture"

    def __init__(self, case_key: str):
        if not re.fullmatch(CASE_KEY_PATTERN, case_key):
            raise ValueError("case_key inválido")
        d = (FIXTURES_DIR / case_key).resolve()
        if not d.is_dir() or not d.is_relative_to(FIXTURES_DIR):
            raise ValueError("case_key inválido")
        self.dir = d
        self._flights = [FlightOffer(**r) for r in self._load("flights.json")]
        self._properties = self._load("lodging.json")
        self._activities = self._load("activities.json")
        self._weather = self._load("weather.json")
        self._transport = [TransportQuote(**r) for r in self._load("transport.json")]

    def _load(self, name: str):
        return json.loads((self.dir / name).read_text(encoding="utf-8"))

    def trip_request(self) -> TripRequest:
        return TripRequest.model_validate(self._load("trip_request.json"))

    async def flights(self, queries: list[FlightQuery]) -> list[FlightOffer]:
        keys = {(o, d, q.date) for q in queries for o in q.origins for d in q.destinations}
        return [f for f in self._flights if (f.origin, f.destination, f.depart_at.date()) in keys]

    async def lodging(self, stays: list[Stay]) -> list[LodgingOffer]:
        out = []
        for st in stays:
            for p in self._properties:
                if p["city"] != st.city:
                    continue
                units = [
                    LodgingUnit(
                        unit_type=u["unit_type"],
                        capacity=u["capacity"],
                        bedrooms=u["bedrooms"],
                        bathrooms=u["bathrooms"],
                        bathrooms_source=u.get("bathrooms_source", "explicit"),
                        available=u["available"],
                        base_total_minor=u["nightly_minor"] * st.nights,
                        fees_total_minor=u.get("per_night_fee_minor", 0) * st.nights,
                    )
                    for u in p["units"]
                ]
                out.append(
                    LodgingOffer(
                        id=f"{p['id']}@{st.check_in}/{st.check_out}",
                        provider=self.name,
                        city=st.city,
                        name=p["name"],
                        check_in=st.check_in,
                        check_out=st.check_out,
                        units=units,
                        stay_fee_minor=p.get("stay_fee_minor", 0),
                        tax_bps=p["tax_bps"],
                        min_nights=p.get("min_nights", 1),
                        short_term_legal=p.get("short_term_legal", True),
                        deeplink=p.get("deeplink"),
                    )
                )
        return out

    async def activities(self, city_days: list[tuple[str, date]]) -> list[ActivityOffer]:
        out = []
        for city, d in city_days:
            for a in self._activities:
                if a["city"] != city or d.isoformat() in a.get("closed_dates", []):
                    continue
                weekend = a.get("weekend_premium_minor", 0) if d.weekday() >= 5 else 0
                out.append(
                    ActivityOffer(
                        id=f"{a['key']}@{d}",
                        provider=self.name,
                        city=city,
                        activity_key=a["key"],
                        name=a["name"],
                        date=d,
                        price_per_pax_minor=a["base_minor"] + weekend,
                        outdoor=a["outdoor"],
                        slots=a["slots"],
                        deeplink=a.get("deeplink"),
                    )
                )
        return out

    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]:
        out = []
        for city, d in city_days:
            spec = self._weather.get(city)
            if spec is None:
                continue
            values = {**spec["default"], **spec.get("overrides", {}).get(d.isoformat(), {})}
            out.append(WeatherDay(city=city, date=d, source=spec["source"], **values))
        return out

    async def transport(self, cities: list[str]) -> list[TransportQuote]:
        return [q for q in self._transport if q.city in cities]


@lru_cache(maxsize=16)
def get_fixture(case_key: str) -> FixtureProvider:
    """FixtureProvider compartido: sus datos son de solo lectura, así se leen del disco una sola vez."""
    return FixtureProvider(case_key)
```

### Clima real: climatología + pronóstico

**`engine/app/providers/weather.py`**

```python
"""Clima: pronóstico (OpenWeather One Call 3.0, horizonte <= 7 días) + climatología histórica.

La climatología se calcula con N años de historia diaria y una ventana de ±W días alrededor de
la fecha objetivo (N*(2W+1) muestras): P(lluvia >= heavy_mm) y tmax media.
Open-Meteo devuelve 10 años en UNA llamada por ciudad; OpenWeather day_summary requeriría
una llamada por fecha y año. Por eso la climatología usa Open-Meteo por defecto.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import httpx

from app.domain.models import WeatherDay
from app.services.cache import TTL_S, Cache, cache_key, cached
from app.services.http import RequestStats, fetch_json

HEAVY_RAIN_MM = 10.0


def _same_day(year: int, d: date) -> date:
    try:
        return d.replace(year=year)
    except ValueError:  # 29/02 en año no bisiesto
        return date(year, 2, 28)


def climatology(
    city: str,
    target: date,
    history: dict[date, tuple[float | None, float | None]],
    years: range,
    window_days: int,
    heavy_mm: float,
    source: str,
) -> WeatherDay:
    tmax: list[float] = []
    wet = n = 0
    for y in years:
        center = _same_day(y, target)
        for off in range(-window_days, window_days + 1):
            sample = history.get(center + timedelta(days=off))
            if sample is None:
                continue
            tx, precip = sample
            if tx is not None:
                tmax.append(tx)
            if precip is not None:
                n += 1
                wet += precip >= heavy_mm
    if n == 0 or not tmax:
        raise ValueError(f"sin historia climática para {city} {target}")
    return WeatherDay(
        city=city,
        date=target,
        tmax_c=round(sum(tmax) / len(tmax), 1),
        heavy_rain_prob=round(wet / n, 3),
        source=f"{source}:{years.start}-{years.stop - 1}",
    )


class OpenMeteoClimatology:
    name = "open_meteo_climatology"
    URL = "https://archive-api.open-meteo.com/v1/archive"

    def __init__(
        self,
        coords: dict[str, tuple[float, float]],
        client: httpx.AsyncClient,
        cache: Cache,
        stats: RequestStats | None = None,
        years: int = 10,
        window_days: int = 3,
        today: date | None = None,
    ):
        self.coords, self.client, self.cache, self.stats = coords, client, cache, stats
        self.window_days = window_days
        last = (today or date.today()).year - 1
        self.years = range(last - years + 1, last + 1)

    async def _history(self, city: str) -> dict[date, tuple[float | None, float | None]]:
        lat, lon = self.coords[city]
        params = {
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "start_date": date(self.years.start, 1, 1).isoformat(),
            "end_date": date(self.years.stop - 1, 12, 31).isoformat(),
            "daily": "temperature_2m_max,precipitation_sum",
            "timezone": "auto",
        }
        data, hit = await cached(
            self.cache,
            cache_key(self.name, self.URL, params),
            self.name,
            TTL_S["weather_history"],
            lambda: fetch_json(self.client, "GET", self.URL, provider=self.name, stats=self.stats, params=params),
        )
        if hit and self.stats is not None:
            self.stats.cache_hits += 1
        d = data["daily"]
        return {
            date.fromisoformat(t): (tx, p)
            for t, tx, p in zip(d["time"], d["temperature_2m_max"], d["precipitation_sum"])
        }

    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]:
        by_city: dict[str, list[date]] = defaultdict(list)
        for city, d in city_days:
            by_city[city].append(d)
        cities = list(by_city)
        histories = await asyncio.gather(*(self._history(c) for c in cities))
        return [
            climatology(city, d, hist, self.years, self.window_days, HEAVY_RAIN_MM, self.name)
            for city, hist in zip(cities, histories)
            for d in by_city[city]
        ]


class OpenWeatherForecast:
    name = "openweather_onecall"
    URL = "https://api.openweathermap.org/data/3.0/onecall"
    HORIZON_DAYS = 7

    def __init__(self, api_key: str, coords, client, cache: Cache, stats: RequestStats | None = None):
        self.api_key, self.coords, self.client, self.cache, self.stats = api_key, coords, client, cache, stats

    async def _daily(self, city: str) -> dict[date, WeatherDay]:
        lat, lon = self.coords[city]
        params = {"lat": round(lat, 4), "lon": round(lon, 4), "exclude": "current,minutely,hourly,alerts", "units": "metric"}
        data, hit = await cached(
            self.cache,
            cache_key(self.name, self.URL, params),  # la key de cache NO incluye appid
            self.name,
            TTL_S["weather_forecast"],
            lambda: fetch_json(
                self.client, "GET", self.URL, provider=self.name, stats=self.stats,
                params={**params, "appid": self.api_key},
            ),
        )
        if hit and self.stats is not None:
            self.stats.cache_hits += 1
        offset = data.get("timezone_offset", 0)
        out = {}
        for day in data.get("daily", []):
            d = datetime.fromtimestamp(day["dt"] + offset, tz=timezone.utc).date()
            pop, rain = float(day.get("pop", 0.0)), float(day.get("rain", 0.0))
            # Heurística documentada: P(>=10 mm) ~ pop si el acumulado esperado ya supera el umbral.
            heavy = pop if rain >= HEAVY_RAIN_MM else pop * rain / HEAVY_RAIN_MM
            out[d] = WeatherDay(
                city=city, date=d, tmax_c=float(day["temp"]["max"]),
                heavy_rain_prob=round(min(1.0, heavy), 3), source=self.name,
            )
        return out

    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]:
        out = []
        for city in sorted({c for c, _ in city_days}):
            daily = await self._daily(city)
            out.extend(daily[d] for c, d in city_days if c == city and d in daily)
        return out


class CompositeWeather:
    """Pronóstico para fechas cercanas; climatología para el resto (y como respaldo)."""

    name = "weather_composite"

    def __init__(self, climatology_provider, forecast_provider=None, today: date | None = None):
        self.clim, self.forecast = climatology_provider, forecast_provider
        self.today = today or date.today()

    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]:
        horizon = self.today + timedelta(days=OpenWeatherForecast.HORIZON_DAYS)
        near = [(c, d) for c, d in city_days if d <= horizon] if self.forecast else []
        got = await self.forecast.weather(near) if near else []
        covered = {(w.city, w.date) for w in got}
        rest = [(c, d) for c, d in city_days if (c, d) not in covered]
        return got + (await self.clim.weather(rest) if rest else [])
```

### Selección por modo

**`engine/app/providers/registry.py`**

```python
"""Selección de proveedores según el modo de la corrida.

fixture : todo sale del caso hardcodeado (determinístico, sin red).
hybrid  : clima REAL + resto fixture (valida integración externa sin gastar en precios).
live    : solo categorías con adapter real configurado; el resto devuelve 501.
"""
from __future__ import annotations

import httpx

from app.domain.models import TripRequest
from app.providers.base import KINDS, fetch
from app.providers.fixture import get_fixture
from app.providers.weather import CompositeWeather, OpenMeteoClimatology, OpenWeatherForecast
from app.services.cache import Cache
from app.services.http import RequestStats
from app.settings import Settings

__all__ = ["KINDS", "ProviderNotConfigured", "build_providers", "extract"]


class ProviderNotConfigured(LookupError):
    pass


def build_providers(
    mode: str, req: TripRequest, s: Settings, client: httpx.AsyncClient, cache: Cache, stats: RequestStats
) -> dict[str, object]:
    fixture = get_fixture(req.case_key) if req.case_key else None
    if mode in ("fixture", "hybrid") and fixture is None:
        raise ProviderNotConfigured(f"modo {mode} requiere case_key")
    if mode == "fixture":
        return {k: fixture for k in KINDS}

    coords = {c.code: (c.lat, c.lon) for c in req.cities}
    forecast = (
        OpenWeatherForecast(s.openweather_api_key, coords, client, cache, stats)
        if s.openweather_api_key
        else None
    )
    weather = CompositeWeather(OpenMeteoClimatology(coords, client, cache, stats), forecast)
    if mode == "hybrid":
        return {"flights": fixture, "lodging": fixture, "activities": fixture, "transport": fixture, "weather": weather}
    # live: agregar aquí los adapters reales a medida que se integren (spike de Fase 1).
    return {"weather": weather}


async def extract(providers: dict[str, object], kind: str, plan) -> list:
    p = providers.get(kind)
    if p is None:
        raise ProviderNotConfigured(f"sin proveedor para '{kind}'")
    return await fetch(p, kind, plan)
```

## 1.6 Resiliencia: rate limit, reintentos y caché

**`engine/app/services/http.py`**

```python
"""Cliente HTTP resiliente: token bucket por proveedor + reintentos con backoff exponencial,
jitter y respeto de Retry-After. Nunca loguea query params (pueden contener API keys)."""
from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field

import httpx

RETRYABLE = {429, 500, 502, 503, 504}


class UpstreamError(RuntimeError):
    def __init__(self, provider: str, status: int | None, detail: str):
        super().__init__(f"{provider} status={status}: {detail}")
        self.provider, self.status = provider, status


class TokenBucket:
    """rate_per_s tokens/segundo con ráfaga máxima `burst`. Un token = una llamada."""

    def __init__(self, rate_per_s: float, burst: int = 1):
        self.rate, self.capacity = rate_per_s, burst
        self.tokens = float(burst)
        self.updated = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                await asyncio.sleep((1 - self.tokens) / self.rate)


# Límites conservadores por proveedor (ajustar al plan contratado).
LIMITERS: dict[str, TokenBucket] = {
    "open_meteo_climatology": TokenBucket(rate_per_s=5, burst=5),
    "openweather_onecall": TokenBucket(rate_per_s=1, burst=2),
}


def limiter_for(provider: str) -> TokenBucket:
    return LIMITERS.setdefault(provider, TokenBucket(rate_per_s=2, burst=2))


@dataclass
class RequestStats:
    api_calls: int = 0
    cache_hits: int = 0
    events: list[dict] = field(default_factory=list)  # -> tabla api_usage


async def fetch_json(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    provider: str,
    stats: RequestStats | None = None,
    params: dict | None = None,
    json: dict | None = None,
    headers: dict | None = None,
    max_attempts: int = 4,
    base_delay_s: float = 0.5,
    max_delay_s: float = 8.0,
):
    limiter = limiter_for(provider)
    for attempt in range(1, max_attempts + 1):
        await limiter.acquire()
        t0 = time.monotonic()
        status, resp = None, None
        try:
            resp = await client.request(method, url, params=params, json=json, headers=headers)
            status = resp.status_code
        except (httpx.TimeoutException, httpx.TransportError):
            pass
        if stats is not None:
            stats.api_calls += 1
            stats.events.append(
                {"provider": provider, "endpoint": url, "status_code": status,
                 "latency_ms": int((time.monotonic() - t0) * 1000)}
            )
        if status is not None and status < 400:
            return resp.json()
        if status is not None and status not in RETRYABLE:
            raise UpstreamError(provider, status, resp.text[:200])
        if attempt == max_attempts:
            raise UpstreamError(provider, status, f"agotados {max_attempts} intentos")
        delay = min(max_delay_s, base_delay_s * 2 ** (attempt - 1)) * random.uniform(0.5, 1.0)
        retry_after = resp.headers.get("Retry-After") if resp is not None else None
        if status == 429 and retry_after and retry_after.isdigit():
            delay = max(delay, float(retry_after))
        await asyncio.sleep(delay)
```

**`engine/app/services/cache.py`**

```python
"""Caché de respuestas externas (cache-first) con coalescencia de pedidos concurrentes.

TTL por tipo de dato: los precios caducan rápido; el clima histórico nunca caduca.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
from typing import Any, Awaitable, Callable, Protocol

TTL_S = {
    "flights": 30 * 60,
    "lodging": 6 * 3600,
    "activities": 24 * 3600,
    "weather_forecast": 3 * 3600,
    "weather_history": None,  # inmutable
}


class Cache(Protocol):
    async def get(self, key: str) -> Any | None: ...

    async def set(self, key: str, provider: str, value: Any, ttl_s: int | None) -> None: ...


def cache_key(provider: str, endpoint: str, params: dict) -> str:
    """params NUNCA debe incluir credenciales."""
    raw = json.dumps([provider, endpoint, params], sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


class MemoryCache:
    def __init__(self):
        self._data: dict[str, tuple[Any, float | None]] = {}

    async def get(self, key: str) -> Any | None:
        hit = self._data.get(key)
        if hit is None:
            return None
        value, expires = hit
        if expires is not None and expires < time.monotonic():
            self._data.pop(key, None)
            return None
        return value

    async def set(self, key: str, provider: str, value: Any, ttl_s: int | None) -> None:
        self._data[key] = (value, None if ttl_s is None else time.monotonic() + ttl_s)


_inflight: dict[str, asyncio.Future] = {}


async def cached(
    cache: Cache, key: str, provider: str, ttl_s: int | None, fetch: Callable[[], Awaitable[Any]]
) -> tuple[Any, bool]:
    """Devuelve (valor, fue_cache_hit). Pedidos idénticos simultáneos comparten una sola llamada."""
    hit = await cache.get(key)
    if hit is not None:
        return hit, True
    if key in _inflight:
        return await asyncio.shield(_inflight[key]), True
    fut = asyncio.get_running_loop().create_future()
    fut.add_done_callback(lambda f: f.cancelled() or f.exception())
    _inflight[key] = fut
    try:
        value = await fetch()
        await cache.set(key, provider, value, ttl_s)
        fut.set_result(value)
        return value, False
    except Exception as exc:
        fut.set_exception(exc)
        raise
    finally:
        _inflight.pop(key, None)
```

## 1.7 Persistencia

**`engine/app/repo/base.py`**

```python
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel

from app.domain import models
from app.domain.models import OfferSet, TripRequest

NON_TERMINAL = {"queued", "extracting", "optimizing"}
OFFER_MODELS = {
    "flights": "FlightOffer",
    "lodging": "LodgingOffer",
    "activities": "ActivityOffer",
    "weather": "WeatherDay",
    "transport": "TransportQuote",
}


@dataclass
class RunRecord:
    id: str
    user_id: str | None
    status: str
    mode: str
    request: TripRequest
    summary: dict
    error: dict | None
    timings: dict


def offer_key(kind: str, o: BaseModel) -> tuple[str, str]:
    """(offer_id, provider) estable para el upsert idempotente."""
    if kind == "weather":
        return f"{o.city}@{o.date.isoformat()}", o.source
    return o.id, o.provider


def build_offer_set(rows: Iterable[tuple[str, dict]]) -> OfferSet:
    """Reconstruye un OfferSet desde filas (kind, payload) respetando el orden recibido."""
    data: dict[str, list] = {k: [] for k in OFFER_MODELS}
    for kind, payload in rows:
        data[kind].append(getattr(models, OFFER_MODELS[kind]).model_validate(payload))
    return OfferSet(**data)


class Repository(Protocol):
    async def create_run(self, req: TripRequest, mode: str, user_id: str | None) -> str: ...

    async def get_run(self, run_id: str) -> RunRecord | None: ...

    async def transition(
        self, run_id: str, allowed_from: set[str], to: str, *, summary: dict | None = None, error: dict | None = None
    ) -> bool: ...

    async def upsert_offers(self, run_id: str, kind: str, offers: list[BaseModel]) -> int: ...

    async def load_offers(self, run_id: str) -> OfferSet: ...

    async def save_itineraries(self, run_id: str, user_id: str | None, rows: list[dict]) -> None: ...

    async def get_itineraries(self, run_id: str) -> list[dict]: ...

    async def log_usage(self, run_id: str, events: list[dict]) -> None: ...

    async def reap_stale(self, older_than_s: int) -> int: ...

    async def close(self) -> None: ...
```

**`engine/app/repo/memory.py`**

```python
"""Repositorio en memoria: tests y desarrollo sin base de datos. Misma semántica que Postgres."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.domain.models import OfferSet, TripRequest
from app.repo.base import NON_TERMINAL, RunRecord, build_offer_set, offer_key


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MemoryRepository:
    def __init__(self):
        self.runs: dict[str, dict] = {}
        self.offers: dict[tuple[str, str, str], dict] = {}
        self.itineraries: dict[str, list[dict]] = {}
        self.usage: list[dict] = []

    async def create_run(self, req: TripRequest, mode: str, user_id: str | None) -> str:
        rid = str(uuid.uuid4())
        self.runs[rid] = {
            "id": rid, "user_id": user_id, "status": "queued", "mode": mode,
            "request": req, "summary": {}, "error": None,
            "timings": {"queued": _now().isoformat()}, "updated_at": _now(),
        }
        return rid

    async def get_run(self, run_id: str) -> RunRecord | None:
        r = self.runs.get(run_id)
        if r is None:
            return None
        return RunRecord(**{k: v for k, v in r.items() if k != "updated_at"})

    async def transition(self, run_id, allowed_from, to, *, summary=None, error=None) -> bool:
        r = self.runs.get(run_id)
        if r is None or r["status"] not in allowed_from:
            return False
        r["status"] = to
        r["timings"][to] = _now().isoformat()
        r["updated_at"] = _now()
        if summary is not None:
            r["summary"] = summary
        if error is not None:
            r["error"] = error
        return True

    async def upsert_offers(self, run_id, kind, offers) -> int:
        for o in offers:
            oid, provider = offer_key(kind, o)
            self.offers[(run_id, kind, oid)] = {"provider": provider, "payload": o.model_dump(mode="json")}
        return len(offers)

    async def load_offers(self, run_id) -> OfferSet:
        return build_offer_set(
            (kind, row["payload"]) for (rid, kind, _), row in sorted(self.offers.items()) if rid == run_id
        )

    async def save_itineraries(self, run_id, user_id, rows) -> None:
        self.itineraries[run_id] = list(rows)

    async def get_itineraries(self, run_id) -> list[dict]:
        return self.itineraries.get(run_id, [])

    async def log_usage(self, run_id, events) -> None:
        self.usage.extend({**e, "run_id": run_id} for e in events)

    async def reap_stale(self, older_than_s: int) -> int:
        limit = _now() - timedelta(seconds=older_than_s)
        n = 0
        for r in self.runs.values():
            if r["status"] in NON_TERMINAL and r["updated_at"] < limit:
                r.update(status="failed", error={"code": "stale_run"}, updated_at=_now())
                n += 1
        return n

    async def close(self) -> None:
        return None
```

**`engine/app/repo/postgres.py`**

```python
"""Repositorio Postgres (Supabase). El motor es el ÚNICO escritor de estas tablas.

DATABASE_URL local : postgresql://postgres:postgres@127.0.0.1:54322/postgres
DATABASE_URL prod  : cadena del Session pooler de Supabase (IPv4), con sslmode=require
"""
from __future__ import annotations

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.domain.models import OfferSet, TripRequest
from app.repo.base import NON_TERMINAL, RunRecord, build_offer_set, offer_key


class PgRepository:
    def __init__(self, dsn: str):
        self.pool = AsyncConnectionPool(
            dsn, min_size=1, max_size=10, open=False,
            kwargs={"prepare_threshold": None, "row_factory": dict_row},  # compatible con pooler
        )

    async def open(self) -> "PgRepository":
        await self.pool.open(wait=True, timeout=10)  # falla al arrancar si la DB no responde, no en cada request
        return self

    async def close(self) -> None:
        await self.pool.close()

    async def create_run(self, req: TripRequest, mode: str, user_id: str | None) -> str:
        async with self.pool.connection() as conn:
            tr = await (
                await conn.execute(
                    "insert into public.trip_requests (user_id, case_key, payload) values (%s, %s, %s) returning id",
                    (user_id, req.case_key, Jsonb(req.model_dump(mode="json"))),
                )
            ).fetchone()
            run = await (
                await conn.execute(
                    """insert into public.search_runs (trip_request_id, user_id, mode, timings)
                       values (%s, %s, %s, jsonb_build_object('queued', now())) returning id""",
                    (tr["id"], user_id, mode),
                )
            ).fetchone()
            return str(run["id"])

    async def get_run(self, run_id: str) -> RunRecord | None:
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    """select r.id, r.user_id, r.status::text as status, r.mode::text as mode,
                              r.summary, r.error, r.timings, t.payload as request
                       from public.search_runs r join public.trip_requests t on t.id = r.trip_request_id
                       where r.id = %s""",
                    (run_id,),
                )
            ).fetchone()
        if row is None:
            return None
        return RunRecord(
            id=str(row["id"]), user_id=str(row["user_id"]) if row["user_id"] else None,
            status=row["status"], mode=row["mode"], request=TripRequest.model_validate(row["request"]),
            summary=row["summary"], error=row["error"], timings=row["timings"],
        )

    async def transition(self, run_id, allowed_from, to, *, summary=None, error=None) -> bool:
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    """update public.search_runs
                       set status  = %s::public.run_status,
                           summary = coalesce(%s, summary),
                           error   = coalesce(%s, error),
                           timings = timings || jsonb_build_object(%s::text, now())
                       where id = %s and status = any(%s::public.run_status[])
                       returning id""",
                    (to, Jsonb(summary) if summary is not None else None,
                     Jsonb(error) if error is not None else None, to, run_id, list(allowed_from)),
                )
            ).fetchone()
            return row is not None

    async def upsert_offers(self, run_id, kind, offers) -> int:
        rows = []
        for o in offers:
            oid, provider = offer_key(kind, o)
            rows.append((run_id, kind, oid, provider, Jsonb(o.model_dump(mode="json"))))
        if not rows:
            return 0
        async with self.pool.connection() as conn, conn.cursor() as cur:
            await cur.executemany(
                """insert into public.run_offers (run_id, kind, offer_id, provider, payload)
                   values (%s, %s, %s, %s, %s)
                   on conflict (run_id, kind, offer_id)
                   do update set payload = excluded.payload, provider = excluded.provider""",
                rows,
            )
        return len(rows)

    async def load_offers(self, run_id) -> OfferSet:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    "select kind, payload from public.run_offers where run_id = %s order by kind, offer_id",
                    (run_id,),
                )
            ).fetchall()
        return build_offer_set((r["kind"], r["payload"]) for r in rows)

    async def save_itineraries(self, run_id, user_id, rows) -> None:
        async with self.pool.connection() as conn:
            async with conn.transaction():
                await conn.execute("delete from public.itineraries where run_id = %s", (run_id,))
                async with conn.cursor() as cur:
                    await cur.executemany(
                        """insert into public.itineraries
                           (run_id, rank, user_id, skeleton_id, total_minor, currency, within_budget, payload)
                           values (%s, %s, %s, %s, %s, %s, %s, %s)""",
                        [(run_id, it["rank"], user_id, it["skeleton_id"], it["total_minor"],
                          it["currency"], it["within_budget"], Jsonb(it)) for it in rows],
                    )

    async def get_itineraries(self, run_id) -> list[dict]:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    "select payload from public.itineraries where run_id = %s order by rank", (run_id,)
                )
            ).fetchall()
        return [r["payload"] for r in rows]

    async def log_usage(self, run_id, events) -> None:
        if not events:
            return
        async with self.pool.connection() as conn, conn.cursor() as cur:
            await cur.executemany(
                """insert into public.api_usage (provider, endpoint, status_code, latency_ms, run_id)
                   values (%s, %s, %s, %s, %s)""",
                [(e["provider"], e["endpoint"], e["status_code"], e["latency_ms"], run_id) for e in events],
            )

    async def reap_stale(self, older_than_s: int) -> int:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    """update public.search_runs
                       set status = 'failed', error = jsonb_build_object('code', 'stale_run')
                       where status = any(%s::public.run_status[])
                         and updated_at < now() - make_interval(secs => %s)
                       returning id""",
                    (list(NON_TERMINAL), older_than_s),
                )
            ).fetchall()
        return len(rows)


class PgCache:
    """Implementación de app.services.cache.Cache sobre la tabla api_cache."""

    def __init__(self, pool: AsyncConnectionPool):
        self.pool = pool

    async def get(self, key: str):
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    """select payload from public.api_cache
                       where cache_key = %s and (expires_at is null or expires_at > now())""",
                    (key,),
                )
            ).fetchone()
        return None if row is None else row["payload"]

    async def set(self, key: str, provider: str, value, ttl_s: int | None) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                """insert into public.api_cache (cache_key, provider, payload, fetched_at, expires_at)
                   values (%s, %s, %s, now(),
                           case when %s::int is null then null else now() + make_interval(secs => %s::int) end)
                   on conflict (cache_key) do update
                   set payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at""",
                (key, provider, Jsonb(value), ttl_s, ttl_s),
            )
```

## 1.8 Configuración y API

**`engine/app/settings.py`**

```python
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

Mode = Literal["fixture", "hybrid", "live"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    env: Literal["local", "staging", "production"] = "production"  # falla cerrado: sin ENV explícito no hay rutas dev
    engine_api_key: str = Field(min_length=24)
    database_url: str | None = None  # sin DB -> repositorio en memoria (solo local/tests)
    default_mode: Mode = "fixture"
    n8n_webhook_url: str | None = None  # p.ej. http://localhost:5678/webhook/plan-trip
    n8n_webhook_secret: str | None = None
    openweather_api_key: str | None = None
    http_timeout_s: float = 20.0
    stale_run_seconds: int = 600

    @property
    def is_dev(self) -> bool:
        return self.env != "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

**`engine/app/api/main.py`**

```python
"""API del motor (FastAPI). n8n orquesta; el motor extrae, persiste y optimiza.

Máquina de estados de una corrida:
  queued -> extracting -> optimizing -> done | infeasible
  (cualquier estado no terminal) -> failed
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from contextlib import asynccontextmanager
from time import perf_counter
from typing import Annotated, Literal
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from app.domain.models import CASE_KEY_PATTERN, TripRequest
from app.optimizer.skeletons import plan_for
from app.providers.fixture import get_fixture
from app.providers.registry import KINDS, ProviderNotConfigured, build_providers, extract
from app.repo.base import NON_TERMINAL, Repository
from app.repo.memory import MemoryRepository
from app.services.cache import MemoryCache
from app.services.http import RequestStats, UpstreamError
from app.settings import Mode, get_settings

try:
    from app.optimizer.service import run_optimization  # se incorpora en la Fase 3
except ImportError:  # Fases 1-2: el endpoint responde 501
    run_optimization = None

logger = logging.getLogger("travelopt.engine")
logging.getLogger("httpx").setLevel(logging.WARNING)  # httpx loguea URLs completas (con API keys en la query)
MAX_BODY_BYTES = 65_536


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    if s.database_url:
        from app.repo.postgres import PgCache, PgRepository

        repo = await PgRepository(s.database_url).open()
        app.state.repo, app.state.cache = repo, PgCache(repo.pool)
    elif s.env == "production":
        raise RuntimeError("DATABASE_URL es obligatorio en producción")
    else:
        app.state.repo, app.state.cache = MemoryRepository(), MemoryCache()
    app.state.http = httpx.AsyncClient(timeout=s.http_timeout_s, headers={"User-Agent": "travelopt-engine/0.1"})
    yield
    await app.state.http.aclose()
    await app.state.repo.close()


app = FastAPI(title="TravelOpt Engine", version="0.1.0", lifespan=lifespan)


class BodyLimitMiddleware:
    """ASGI puro: corta cuerpos de más de 64 KiB, declarados (Content-Length) o recibidos (también chunked)."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            try:
                too_big = int(declared) > self.max_bytes
            except ValueError:
                await JSONResponse({"detail": {"code": "bad_content_length"}}, status_code=400)(scope, receive, send)
                return
            if too_big:
                await JSONResponse({"detail": {"code": "payload_too_large"}}, status_code=413)(scope, receive, send)
                return

        received, rejected = 0, False

        async def limited_receive():
            nonlocal received, rejected
            msg = await receive()
            if msg["type"] == "http.request" and not rejected:
                received += len(msg.get("body", b""))
                if received > self.max_bytes:
                    rejected = True
                    await JSONResponse({"detail": {"code": "payload_too_large"}}, status_code=413)(scope, receive, send)
            return {"type": "http.disconnect"} if rejected else msg

        async def guarded_send(msg):
            if not rejected:  # tras el 413 se descarta lo que la app intente responder
                await send(msg)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:
            if not rejected:
                raise


app.add_middleware(BodyLimitMiddleware)


def repo_dep(request: Request) -> Repository:
    return request.app.state.repo


async def require_key(authorization: str | None = Header(default=None)) -> None:
    expected = f"Bearer {get_settings().engine_api_key}"
    # bytes: compare_digest sobre str lanza TypeError (500) si el header trae caracteres no ASCII
    if not authorization or not secrets.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(401, {"code": "unauthorized"})


def dev_only() -> None:
    if not get_settings().is_dev:
        raise HTTPException(404)


async def dev_delay(delay_ms: int = 0) -> int:
    """Retardo artificial (máx. 10 s) para el checkpoint de concurrencia; solo en dev."""
    if delay_ms:
        dev_only()
    return min(delay_ms, 10_000)


async def load_run(run_id: UUID, repo: Repository):
    run = await repo.get_run(str(run_id))
    if run is None:
        raise HTTPException(404, {"code": "run_not_found"})
    return run


# ---------------------------------------------------------------- creación y disparo


class CreateRunIn(BaseModel):
    trip_request: TripRequest
    user_id: UUID | None = None
    mode: Mode | None = None
    trigger: bool = True  # False: no dispara n8n (tests / run-all)


async def _trigger_n8n(request: Request, run_id: str) -> None:
    s = get_settings()
    if not s.n8n_webhook_url:
        raise HTTPException(503, {"code": "orchestrator_not_configured"})
    try:
        r = await request.app.state.http.post(
            s.n8n_webhook_url,
            json={"run_id": run_id},
            headers={"X-Webhook-Secret": s.n8n_webhook_secret or ""},
            timeout=10,
        )
        r.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("no se pudo disparar n8n (run_id=%s)", run_id)
        await request.app.state.repo.transition(
            run_id, NON_TERMINAL, "failed", error={"code": "orchestrator_unavailable", "message": type(exc).__name__}
        )
        raise HTTPException(503, {"code": "orchestrator_unavailable"}) from exc


async def _create(request: Request, body: CreateRunIn, repo: Repository) -> dict:
    mode = body.mode or get_settings().default_mode
    run_id = await repo.create_run(body.trip_request, mode, str(body.user_id) if body.user_id else None)
    if body.trigger:
        await _trigger_n8n(request, run_id)
    return {"run_id": run_id, "status": "queued", "mode": mode}


@app.get("/healthz")
async def healthz():
    s = get_settings()
    return {"ok": True, "env": s.env, "default_mode": s.default_mode, "version": app.version}


@app.post("/v1/runs", status_code=202, dependencies=[Depends(require_key)])
async def create_run(body: CreateRunIn, request: Request, repo: Repository = Depends(repo_dep)):
    return await _create(request, body, repo)


@app.post("/v1/dev/runs/{case_key}", status_code=202, dependencies=[Depends(require_key), Depends(dev_only)])
async def create_fixture_run(case_key: Annotated[str, Path(pattern=CASE_KEY_PATTERN)], request: Request,
                             trigger: bool = True, mode: Mode = "fixture", repo: Repository = Depends(repo_dep)):
    try:
        req = get_fixture(case_key).trip_request()
    except ValueError as exc:  # case_key bien formado pero sin carpeta de fixtures
        raise HTTPException(404, {"code": "case_not_found"}) from exc
    return await _create(request, CreateRunIn(trip_request=req, mode=mode, trigger=trigger), repo)


# ---------------------------------------------------------------- pasos que invoca n8n


@app.post("/v1/runs/{run_id}/plan", dependencies=[Depends(require_key)])
async def plan_run(run_id: UUID, repo: Repository = Depends(repo_dep)):
    run = await load_run(run_id, repo)
    plan = plan_for(run.request)
    counts = {"flights": len(plan.flights), "lodging": len(plan.stays), "activities": len(plan.city_days),
              "weather": len(plan.city_days), "transport": len(plan.cities)}
    if not await repo.transition(str(run_id), {"queued"}, "extracting", summary={"query_plan": counts}):
        raise HTTPException(409, {"code": "invalid_state", "status": run.status})
    return {"run_id": str(run_id), "mode": run.mode, "tasks": [{"kind": k, "count": counts[k]} for k in KINDS]}


@app.post("/v1/runs/{run_id}/extract/{kind}", dependencies=[Depends(require_key)])
async def extract_kind(run_id: UUID, kind: Literal["flights", "lodging", "activities", "weather", "transport"],
                       request: Request, delay_ms: int = Depends(dev_delay), repo: Repository = Depends(repo_dep)):
    run = await load_run(run_id, repo)
    if run.status != "extracting":
        raise HTTPException(409, {"code": "invalid_state", "status": run.status})
    if delay_ms:
        await asyncio.sleep(delay_ms / 1000)  # solo para el checkpoint de concurrencia
    t0 = perf_counter()
    stats = RequestStats()
    plan = plan_for(run.request)
    try:
        providers = build_providers(run.mode, run.request, get_settings(), request.app.state.http,
                                    request.app.state.cache, stats)
        offers = await extract(providers, kind, plan)
    except ProviderNotConfigured as exc:
        raise HTTPException(501, {"code": "provider_not_configured", "kind": kind, "message": str(exc)}) from exc
    except UpstreamError as exc:
        raise HTTPException(502, {"code": "upstream_error", "provider": exc.provider, "status": exc.status}) from exc
    finally:
        await repo.log_usage(str(run_id), stats.events)
    n = await repo.upsert_offers(str(run_id), kind, offers)
    return {"kind": kind, "offers": n, "api_calls": stats.api_calls, "cache_hits": stats.cache_hits,
            "elapsed_ms": round((perf_counter() - t0) * 1000, 1)}


@app.post("/v1/runs/{run_id}/optimize", dependencies=[Depends(require_key)])
async def optimize_run(run_id: UUID, repo: Repository = Depends(repo_dep)):
    if run_optimization is None:
        raise HTTPException(501, {"code": "optimizer_not_ready"})
    run = await load_run(run_id, repo)
    if not await repo.transition(str(run_id), {"extracting"}, "optimizing"):
        raise HTTPException(409, {"code": "invalid_state", "status": run.status})
    try:
        return await run_optimization(repo, run)
    except Exception as exc:
        logger.exception("falló el optimizador (run_id=%s)", run_id)
        await repo.transition(str(run_id), NON_TERMINAL, "failed",
                              error={"code": "optimizer_error", "message": type(exc).__name__})
        raise


class FailIn(BaseModel):
    code: str = Field(max_length=64)
    message: str | None = Field(None, max_length=500)
    node: str | None = Field(None, max_length=64)


@app.post("/v1/runs/{run_id}/fail", dependencies=[Depends(require_key)])
async def fail_run(run_id: UUID, body: FailIn, repo: Repository = Depends(repo_dep)):
    await load_run(run_id, repo)
    changed = await repo.transition(str(run_id), NON_TERMINAL, "failed", error=body.model_dump())
    return {"run_id": str(run_id), "changed": changed}


@app.get("/v1/runs/{run_id}", dependencies=[Depends(require_key)])
async def get_run(run_id: UUID, repo: Repository = Depends(repo_dep)):
    run = await load_run(run_id, repo)
    return {"id": run.id, "status": run.status, "mode": run.mode, "summary": run.summary,
            "error": run.error, "timings": run.timings, "itineraries": await repo.get_itineraries(run.id)}


@app.post("/v1/runs/{run_id}/run-all", dependencies=[Depends(require_key), Depends(dev_only)])
async def run_all(run_id: UUID, request: Request, repo: Repository = Depends(repo_dep)):
    """Ejecuta plan -> extract x5 (concurrente) -> optimize en proceso, sin n8n (depuración)."""
    await plan_run(run_id, repo)
    await asyncio.gather(*(extract_kind(run_id, k, request, 0, repo) for k in KINDS))
    return await optimize_run(run_id, repo)


@app.post("/v1/maintenance/reap", dependencies=[Depends(require_key)])
async def reap(repo: Repository = Depends(repo_dep)):
    return {"reaped": await repo.reap_stale(get_settings().stale_run_seconds)}
```

| Endpoint | Quién lo llama | Efecto |
|---|---|---|
| `GET /healthz` | Monitoreo | Estado y modo, sin autenticación |
| `POST /v1/runs` | Next.js (Fase 4) | Valida `TripRequest`, crea la corrida (`queued`) y dispara n8n → `202` |
| `POST /v1/dev/runs/{case_key}` | Devtools y tests (no existe en producción) | Igual, pero con un fixture |
| `POST /v1/runs/{id}/plan` | n8n | `queued → extracting`. Devuelve 5 tareas; `409` si ya avanzó |
| `POST /v1/runs/{id}/extract/{kind}` | n8n (5 en paralelo) | Consulta el proveedor y hace upsert idempotente. `501` si el proveedor no está configurado, `502` si falla upstream |
| `POST /v1/runs/{id}/optimize` | n8n | **501 en esta fase.** Desde la Fase 3: `extracting → optimizing → done/infeasible` |
| `POST /v1/runs/{id}/fail` | n8n | Cualquier estado no terminal pasa a `failed`, con `{code, message, node}` |
| `GET /v1/runs/{id}` | Devtools | Estado, timings e itinerarios |
| `POST /v1/runs/{id}/run-all` | Devtools (no existe en producción) | Todo en proceso, sin n8n |
| `POST /v1/maintenance/reap` | n8n (WF-03) | Marca `failed` las corridas colgadas |

Levantar el motor en desarrollo, desde `engine/`:

```bash
uv run uvicorn app.api.main:app --reload --port 8000
```

## 1.9 Spike de proveedores live (decisión documentada)

Amadeus Self-Service ya no existe. Antes de la Fase 5 hay que elegir un proveedor por categoría y registrarlo en `docs/adr/0001-proveedores.md`. Criterios, con peso sugerido:

| Criterio | Peso |
|---|---|
| Alta self-service o plazo de aprobación | 20 % |
| Cobertura de las rutas EZE–MCO–NYC y de alquileres en Orlando | 20 % |
| Atributos requeridos (baños y dormitorios en alojamiento; valijas en vuelos) | 20 % |
| Costo por búsqueda o reserva y política de *look-to-book* | 15 % |
| Rate limits documentados | 10 % |
| Términos de uso (scraping, deeplinks, afiliación) | 15 % |

Candidatos a evaluar: **vuelos**: Duffel, SerpApi Google Flights y Amadeus Enterprise o el toolkit anunciado con Anthropic; **alojamiento**: LiteAPI y SerpApi Google Hotels (`vacation_rentals`); **actividades**: Viator Partner API, más una tabla curada de parques. Cada adapter nuevo implementa la interfaz de §1.5, agrega su entrada en `LIMITERS` y `TTL_S`, y se registra en `registry.py` para el modo `live`.

## 1.10 Tests de la Fase 1

**`engine/tests/conftest.py`**

```python
import asyncio

import httpx
import pytest

from app.optimizer.skeletons import build_query_plan, generate_skeletons
from app.providers.base import collect_offers
from app.providers.fixture import FixtureProvider
from app.repo.memory import MemoryRepository
from app.services.cache import MemoryCache
from app.settings import get_settings

CASE = "orlando_nyc_5pax"
API_KEY = "test-key-0123456789abcdefghij"


@pytest.fixture(scope="session")
def provider():
    return FixtureProvider(CASE)


@pytest.fixture(scope="session")
def req(provider):
    return provider.trip_request()


@pytest.fixture(scope="session")
def plan(req):
    return build_query_plan(req, generate_skeletons(req))


@pytest.fixture(scope="session")
def offers(provider, plan):
    return asyncio.run(collect_offers(plan, provider))


@pytest.fixture
def api(monkeypatch):
    """Cliente HTTP contra la app FastAPI en proceso, con repositorio en memoria."""
    monkeypatch.setenv("ENGINE_API_KEY", API_KEY)
    monkeypatch.setenv("ENV", "local")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    get_settings.cache_clear()
    from app.api.main import app

    app.state.repo, app.state.cache = MemoryRepository(), MemoryCache()
    app.state.http = httpx.AsyncClient()
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://engine",
        headers={"Authorization": f"Bearer {API_KEY}"}, timeout=30,
    )


async def new_fixture_run(api) -> str:
    r = await api.post(f"/v1/dev/runs/{CASE}", params={"trigger": "false"})
    assert r.status_code == 202, r.text
    return r.json()["run_id"]
```

**`engine/tests/test_money.py`**

```python
import pytest

from app.domain.money import apply_bps, fmt, split_evenly, with_tax


@pytest.mark.parametrize(
    "amount,bps,expected",
    [
        (129500, 1250, 16188),  # 16187.5 -> half-up
        (100, 1250, 13),  # 12.5 -> 13
        (100, 1249, 12),
        (0, 1475, 0),
        (99500, 1475, 14676),  # 14676.25
    ],
)
def test_apply_bps_half_up(amount, bps, expected):
    assert apply_bps(amount, bps) == expected


def test_with_tax():
    assert with_tax(129500, 1250) == 145688


def test_negative_rejected():
    with pytest.raises(ValueError):
        apply_bps(-1, 100)


@pytest.mark.parametrize("total,parts", [(2008362, 5), (1, 3), (0, 4), (999_999_999, 7)])
def test_split_evenly_is_exact(total, parts):
    shares = split_evenly(total, parts)
    assert sum(shares) == total
    assert max(shares) - min(shares) <= 1


def test_fmt():
    assert fmt(2008362) == "USD 20,083.62"
```

**`engine/tests/test_query_plan.py`**

```python
from app.optimizer.skeletons import generate_skeletons


def test_skeleton_enumeration(req):
    ids = [s.id for s in generate_skeletons(req)]
    assert len(ids) == 6  # 2 fechas de check-in x 3 repartos de noches (6-6, 7-5, 8-4)
    assert "ORL-NYC|2027-07-08|8-4" in ids


def test_minimal_query_plan(plan):
    assert len(plan.flights) == 9  # 3 (ida, incl. nocturnos) + 4 (ORL->NYC) + 2 (regreso)
    assert len(plan.stays) == 12  # 6 estadías ORL + 6 NYC, sin duplicados
    assert len(plan.city_days) == 14  # 8 días útiles ORL + 6 NYC


def test_overnight_outbound_allowed(req):
    first_leg = generate_skeletons(req)[0].legs[0]
    assert [d.isoformat() for d in first_leg.depart_dates] == ["2027-07-07", "2027-07-08"]
    assert first_leg.arrive_on.isoformat() == "2027-07-08"
```

**`engine/tests/test_fixture_contracts.py`**

```python
def test_fixture_offer_counts(offers):
    assert len(offers.flights) == 15
    assert len(offers.lodging) == 48  # 12 estadías x 4 propiedades por ciudad
    assert len(offers.activities) == 99  # ORL 8 días x 8 actividades - 1 cierre + NYC 6 días x 6 (3 imperdibles + 3 opcionales)
    assert len(offers.weather) == 14
    assert len(offers.transport) == 2


def test_money_is_integer_minor_units(offers):
    assert all(isinstance(f.price_per_pax_minor, int) for f in offers.flights)
    assert all(isinstance(u.base_total_minor, int) for o in offers.lodging for u in o.units)


def test_epic_closed_date_has_no_offer(offers):
    assert not [a for a in offers.activities if a.activity_key == "EPIC" and a.date.isoformat() == "2027-07-15"]
```

**`engine/tests/test_weather_and_http.py`**

```python
"""Clima y cliente HTTP sin red: respuestas simuladas con httpx.MockTransport."""
import asyncio
from datetime import date, timedelta

import httpx
import pytest

from app.providers.weather import CompositeWeather, OpenMeteoClimatology, climatology
from app.services.cache import MemoryCache
from app.services.http import RequestStats, UpstreamError, fetch_json, limiter_for


def _fake_archive(start: date, end: date):
    days, tmax, precip = [], [], []
    d = start
    while d <= end:
        days.append(d.isoformat())
        tmax.append(33.0)
        precip.append(25.0 if d.day % 5 == 0 else 0.0)  # 1 de cada 5 días: lluvia fuerte
        d += timedelta(days=1)
    return {"daily": {"time": days, "temperature_2m_max": tmax, "precipitation_sum": precip}}


def test_climatology_window_math():
    hist = {date(2020, 7, 1) + timedelta(days=i): (30.0 + i % 2, 12.0 if i % 2 else 0.0) for i in range(30)}
    w = climatology("ORL", date(2027, 7, 10), hist, range(2020, 2021), 3, 10.0, "t")
    assert w.heavy_rain_prob == round(3 / 7, 3)  # 7 muestras (10/7 ±3), 3 húmedas
    assert w.source == "t:2020-2020"


def test_open_meteo_one_call_per_city_and_cached():
    calls = []

    def handler(request: httpx.Request):
        calls.append(request.url.params["latitude"])
        p = request.url.params
        return httpx.Response(200, json=_fake_archive(date.fromisoformat(p["start_date"]), date.fromisoformat(p["end_date"])))

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        cache, stats = MemoryCache(), RequestStats()
        prov = OpenMeteoClimatology({"ORL": (28.3852, -81.5639)}, client, cache, stats, today=date(2026, 10, 26))
        days = [("ORL", date(2027, 7, 8) + timedelta(days=i)) for i in range(10)]
        first = await prov.weather(days)
        second = await prov.weather(days)
        assert len(first) == 10 and first == second
        assert len(calls) == 1 and stats.cache_hits == 1  # 10 años en UNA llamada; 2da vez desde caché
        assert all(0.1 < w.heavy_rain_prob < 0.3 for w in first)
        assert first[0].source == "open_meteo_climatology:2016-2025"

    asyncio.run(go())


def test_composite_uses_climatology_beyond_horizon():
    class Clim:
        async def weather(self, cd):
            return [("clim", c, d) for c, d in cd]

    class Fc:
        async def weather(self, cd):
            return []

    async def go():
        out = await CompositeWeather(Clim(), Fc(), today=date(2026, 10, 26)).weather([("ORL", date(2027, 7, 8))])
        assert out == [("clim", "ORL", date(2027, 7, 8))]

    asyncio.run(go())


def test_retry_on_429_then_success():
    state = {"n": 0}

    def handler(request):
        state["n"] += 1
        if state["n"] < 3:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"ok": True})

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        limiter_for("t429").rate = 1000
        stats = RequestStats()
        out = await fetch_json(client, "GET", "https://x.test/a", provider="t429", stats=stats, base_delay_s=0.01)
        assert out == {"ok": True} and state["n"] == 3 and stats.api_calls == 3

    asyncio.run(go())


def test_non_retryable_raises_immediately():
    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401, text="bad key")))
        with pytest.raises(UpstreamError) as e:
            await fetch_json(client, "GET", "https://x.test/b", provider="t401")
        assert e.value.status == 401

    asyncio.run(go())
```

**`engine/tests/test_api_extraction.py`**

```python
"""Contrato HTTP que consume n8n (Fase 1): crear -> plan -> extract x5. Optimize llega en Fase 3."""
import asyncio
import time

from tests.conftest import new_fixture_run

KINDS = ["flights", "lodging", "activities", "weather", "transport"]


def test_requires_api_key(api):
    async def go():
        r = await api.post("/v1/dev/runs/orlando_nyc_5pax", headers={"Authorization": "Bearer nope"})
        assert r.status_code == 401

    asyncio.run(go())


def test_plan_and_parallel_extract(api):
    async def go():
        rid = await new_fixture_run(api)
        plan = (await api.post(f"/v1/runs/{rid}/plan")).json()
        assert [t["kind"] for t in plan["tasks"]] == KINDS
        results = await asyncio.gather(*(api.post(f"/v1/runs/{rid}/extract/{k}") for k in KINDS))
        assert all(r.status_code == 200 for r in results), [r.text for r in results]
        assert {r.json()["kind"]: r.json()["offers"] for r in results} == {
            "flights": 15, "lodging": 48, "activities": 99, "weather": 14, "transport": 2,
        }
        run = (await api.get(f"/v1/runs/{rid}")).json()
        assert run["status"] == "extracting" and run["summary"]["query_plan"]["flights"] == 9

    asyncio.run(go())


def test_state_machine_is_enforced(api):
    async def go():
        rid = await new_fixture_run(api)
        assert (await api.post(f"/v1/runs/{rid}/extract/flights")).status_code == 409  # antes de plan
        assert (await api.post(f"/v1/runs/{rid}/plan")).status_code == 200
        assert (await api.post(f"/v1/runs/{rid}/plan")).status_code == 409  # webhook duplicado
        await api.post(f"/v1/runs/{rid}/fail", json={"code": "test"})
        assert (await api.get(f"/v1/runs/{rid}")).json()["status"] == "failed"

    asyncio.run(go())


def test_extract_is_idempotent(api):
    async def go():
        rid = await new_fixture_run(api)
        await api.post(f"/v1/runs/{rid}/plan")
        a = (await api.post(f"/v1/runs/{rid}/extract/flights")).json()["offers"]
        b = (await api.post(f"/v1/runs/{rid}/extract/flights")).json()["offers"]  # reintento de n8n
        assert a == b == 15

    asyncio.run(go())


def test_parallel_extraction_takes_max_not_sum(api):
    async def go():
        rid = await new_fixture_run(api)
        await api.post(f"/v1/runs/{rid}/plan")
        t0 = time.perf_counter()
        await asyncio.gather(*(api.post(f"/v1/runs/{rid}/extract/{k}", params={"delay_ms": 500}) for k in KINDS))
        assert time.perf_counter() - t0 < 1.5  # en serie serían 2,5 s

    asyncio.run(go())


def test_optimize_returns_501_until_phase_3(api, monkeypatch):
    import app.api.main as main

    monkeypatch.setattr(main, "run_optimization", None)

    async def go():
        rid = await new_fixture_run(api)
        await api.post(f"/v1/runs/{rid}/plan")
        r = await api.post(f"/v1/runs/{rid}/optimize")
        assert r.status_code == 501 and r.json()["detail"]["code"] == "optimizer_not_ready"

    asyncio.run(go())


# ---------------------------------------------------------------- endurecimiento de seguridad


def test_dev_routes_are_closed_in_production(api, monkeypatch):
    """Falla cerrado: con ENV=production las rutas de depuración no existen (404)."""
    from app.settings import get_settings

    monkeypatch.setenv("ENV", "production")
    get_settings.cache_clear()

    async def go():
        try:
            r = await api.post("/v1/dev/runs/orlando_nyc_5pax")
            assert r.status_code == 404
            r = await api.post("/v1/runs/6f1c1a52-0b1e-4c63-9a3d-0f8a5a7d2b11/run-all")
            assert r.status_code == 404
        finally:
            get_settings.cache_clear()

    asyncio.run(go())


def test_env_defaults_to_production(monkeypatch):
    from app.settings import Settings

    monkeypatch.delenv("ENV", raising=False)
    assert Settings(_env_file=None, engine_api_key="x" * 24).env == "production"


def test_invalid_case_key_is_rejected_in_create_run(api):
    async def go():
        r = await api.post("/v1/runs", json={"trip_request": {**_fixture_request(), "case_key": "../x"}, "trigger": False})
        assert r.status_code == 422

    asyncio.run(go())


def test_path_traversal_in_dev_route_is_rejected(api):
    async def go():
        assert (await api.post("/v1/dev/runs/..%2Fx")).status_code in (404, 422)
        assert (await api.post("/v1/dev/runs/..")).status_code in (404, 422)
        assert (await api.post("/v1/dev/runs/" + "a" * 65)).status_code == 422
        assert (await api.post("/v1/dev/runs/inexistente")).status_code == 404  # bien formado, sin carpeta

    asyncio.run(go())


def test_fixture_provider_rejects_bad_case_key():
    import pytest

    from app.providers.fixture import FixtureProvider

    for bad in ("../x", "..", "a/b", "A", "", "x" * 65, "orlando_nyc_5pax/../orlando_nyc_5pax"):
        with pytest.raises(ValueError, match="case_key inválido"):
            FixtureProvider(bad)


def test_non_ascii_authorization_header_is_401_not_500(api):
    async def go():
        r = await api.post("/v1/dev/runs/orlando_nyc_5pax", headers={"Authorization": "Bearer ñandú".encode("latin-1")})
        assert r.status_code == 401

    asyncio.run(go())


def test_oversized_body_is_413(api):
    async def go():
        r = await api.post("/v1/runs/6f1c1a52-0b1e-4c63-9a3d-0f8a5a7d2b11/fail", content=b'{"code":"' + b"x" * 70_000 + b'"}',
                           headers={"Content-Type": "application/json"})
        assert r.status_code == 413

    asyncio.run(go())


def test_oversized_chunked_body_is_413(api):
    async def chunks():  # sin Content-Length: el límite debe aplicarse sobre los bytes recibidos
        for _ in range(8):
            yield b"x" * 10_000

    async def go():
        r = await api.post("/v1/runs/6f1c1a52-0b1e-4c63-9a3d-0f8a5a7d2b11/fail", content=chunks(),
                           headers={"Content-Type": "application/json"})
        assert r.status_code == 413
        assert r.json()["detail"]["code"] == "payload_too_large"

    asyncio.run(go())


def test_fail_in_field_lengths_are_bounded(api):
    async def go():
        rid = await new_fixture_run(api)
        assert (await api.post(f"/v1/runs/{rid}/fail", json={"code": "x" * 65})).status_code == 422
        assert (await api.post(f"/v1/runs/{rid}/fail", json={"code": "ok", "message": "x" * 501})).status_code == 422
        assert (await api.post(f"/v1/runs/{rid}/fail", json={"code": "ok", "node": "x" * 65})).status_code == 422
        assert (await api.post(f"/v1/runs/{rid}/fail", json={"code": "ok", "message": "x" * 500})).status_code == 200

    asyncio.run(go())


def _fixture_request() -> dict:
    from app.providers.fixture import FixtureProvider

    return FixtureProvider("orlando_nyc_5pax").trip_request().model_dump(mode="json")
```

---

## Checkpoints de validación (todos deben dar OK)

**Estado previo:** todo el Python de esta fase se ejecutó (29 tests OK, simulando la fase sin el optimizador), al igual que las herramientas del devtools contra el motor real y la llamada real a Open-Meteo. **No se ejecutaron** el SQL, pgTAP ni `PgRepository`/`PgCache` contra Postgres: es lo primero que validan CP-1.1 a CP-1.3 y CP-1.7.

**Validado el 2026-10-26 contra Supabase local (Python 3.12.15, ruff 0.17.3):** CP-1.1 a CP-1.12 OK y `GATE FASE 1: OK`. Ajustes de esa primera ejecución, ya incorporados arriba:
- `[tool.ruff.lint] select` fijado a los defaults previos a ruff 0.17 (esa versión agregó B, UP, SIM y PLR por defecto) y `l` → `lo` en `collect_offers` (E741).
- `PgRepository.open()` espera el pool (`wait=True`): antes el arranque terminaba "OK" aunque la DB no conectara.

> **Windows:** levantar el motor con `--reload` (`uv run uvicorn app.api.main:app --reload --port 8000`). Sin `--reload` ni `--workers`, uvicorn usa `ProactorEventLoop` y psycopg async no puede conectar; con el cambio de arriba el motor ahora falla al arrancar en vez de quedar levantado sin base. En Linux y Docker no aplica.
>
> Si el repo ya incluye la Fase 3 (`app/optimizer/service.py`), en CP-1.7 `optimize_status_code` da **200** y la corrida termina `done`. Para CP-1.8 estricto (`status = extracting`) correr `plan` + `extract` ×5 sin `optimize`. El 501 lo cubre `test_optimize_returns_501_until_phase_3`.

| ID | Check | Cómo | OK si… |
|---|---|---|---|
| CP-1.1 | Migración | `npx supabase db reset` | Sin errores |
| CP-1.2 | RLS | `npx supabase test db` | `8/8` OK |
| CP-1.3 | Advisors | Studio (http://127.0.0.1:54323) → Advisors → Security | Sin errores críticos sobre las 6 tablas |
| CP-1.4 | Tests | En `engine/`: `uv run pytest -q tests/test_money.py tests/test_query_plan.py tests/test_fixture_contracts.py tests/test_weather_and_http.py tests/test_api_extraction.py` | `29 passed` |
| CP-1.5 | Lint | `uv run ruff check .` | `All checks passed!` |
| CP-1.6 | Contrato | `uv run python -m scripts.export_contracts` | Se generan `contracts/TripRequest.schema.json` y `OfferSet.schema.json`, y se commitean |
| CP-1.7 | Extracción con Postgres real | `.env` con `DATABASE_URL` local, motor levantado. Claude: `run_extraction_inprocess` (modo `fixture`) | Ofertas por tipo: flights **15**, lodging **48**, activities **99** (57 hasta el catálogo de opcionales de 4b), weather **14**, transport **2** · `optimize_status_code` = **501** |
| CP-1.8 | Persistencia | Claude, con `supabase-local`: `select kind, count(*) from run_offers where run_id = '<id>' group by kind` y `select status from search_runs where id = '<id>'` | Los mismos conteos de CP-1.7 y `status = extracting` |
| CP-1.9 | Idempotencia | Repetir `POST /extract/flights` sobre la misma corrida | El conteo de `flights` sigue en 15 |
| CP-1.10 | Clima real + caché | `run_extraction_inprocess` con `mode="hybrid"`, **dos veces** | 1ª vez: weather `api_calls = 2`. 2ª vez: `api_calls = 0`, `cache_hits = 2`. En `run_offers`, `payload->>'source'` empieza con `open_meteo_climatology:`; en ORL, `heavy_rain_prob` entre 0,10 y 0,45 y `tmax_c` entre 29 y 35 |
| CP-1.11 | Modo live sin proveedores | `run_extraction_inprocess` con `mode="live"` | flights, lodging, activities y transport responden **501**; weather OK |
| CP-1.12 | Sin claves en logs | `select count(*) from api_usage where endpoint ilike '%appid%' or endpoint ilike '%key%'` | `0` |
| CP-1.13 | Spike | `docs/adr/0001-proveedores.md` commiteado | Hay un proveedor elegido (o "fixture hasta X") por categoría, con la matriz completa |
| CP-1.14 | Gate | `uv run python scripts/gate.py 1` | `GATE FASE 1: OK` |

> Al cerrar: actualizar la tabla *Estado* de `master_plan.md` y hacer un commit `fase-1: gate OK`.
