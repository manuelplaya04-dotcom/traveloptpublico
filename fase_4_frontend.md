# Fase 4: frontend (Next.js)

**Objetivo:** que el usuario cargue parámetros y restricciones, vea avanzar la corrida en tiempo real y reciba el itinerario óptimo con la **calculadora financiera** completa, el embudo de descartes, las alternativas y los enlaces de compra.
**Requisito previo:** `GATE FASE 3: OK`. Durante el desarrollo tienen que estar arriba el motor (8000), n8n (5678) y Supabase local.
**Salida:** app Next.js 16 en `web/` con lint, typecheck, unit y build en verde, bundle sin secretos y 3 e2e en verde.

---

## 4.1 Crear el proyecto

Desde la raíz del repo:

```bash
npx create-next-app@latest web --typescript --eslint --tailwind --app --no-src-dir --import-alias "@/*" --use-npm
```

Aceptar los valores por defecto en el resto de las preguntas. Después, dentro de `web/`:

```bash
npm i @supabase/supabase-js @supabase/ssr zod server-only
```

```bash
npm i -D vitest @playwright/test
```

```bash
npx playwright install chromium
```

Agregar a `web/package.json`, en `"scripts"` (create-next-app ya trae `dev`, `build`, `start` y `lint`):

```json
"typecheck": "tsc --noEmit",
"test": "vitest run",
"e2e": "playwright test"
```

Copiar el caso de prueba del motor (el test de contrato verifica que sean idénticos):

```bash
cp ../engine/fixtures/orlando_nyc_5pax/trip_request.json lib/demo-case.json
```

## 4.2 Variables de entorno (`web/.env.local`, nunca commitear)

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key de npx supabase status>
ENGINE_BASE_URL=http://localhost:8000
ENGINE_API_KEY=<mismo valor que en el .env de la raíz>
```

> Regla: lo que lleva `NEXT_PUBLIC_` llega al navegador. `ENGINE_API_KEY` **no** lo lleva y solo se usa en `lib/engine.ts`, marcado con `import "server-only"`.

## 4.3 Arquitectura del frontend

| Pieza | Dónde corre | Qué hace |
|---|---|---|
| `app/page.tsx` | Navegador | Formulario precargado con el caso; asegura una sesión anónima; `POST /api/trips` |
| `app/api/trips/route.ts` | Servidor (Vercel) | Valida con zod, obtiene `user.id` de Supabase y llama a `POST /v1/runs` del motor con la API key |
| `app/runs/[id]/page.tsx` + `components/RunView.tsx` | Navegador | Realtime sobre `search_runs` (más sondeo cada 3 s); al llegar a `done` lee `itineraries` (con RLS) |
| `components/BreakdownTable.tsx` | Navegador | Calculadora: línea, cantidad, subtotal, impuestos, total y "Comprar" |
| `components/Funnel.tsx` | Navegador | Embudo de descartes con los motivos traducidos |
| `proxy.ts` | Servidor | Refresca la sesión de Supabase en cada request (Next 16; en Next ≤ 15 se llama `middleware.ts`) |

## 4.4 Código

**`web/lib/contracts.ts`**

```ts
// Espejo en zod del contrato canónico (engine/app/domain/models.py). Validación de UX:
// la validación autoritativa la hace Pydantic en el motor. test/contracts.test.ts verifica que no diverjan.
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD");
const iata = z.string().regex(/^[A-Z]{3}$/, "Código IATA de 3 letras");

export const constraintsSchema = z.object({
  min_bathrooms: z.number().int().min(0).max(10),
  min_bedrooms: z.number().int().min(0).max(10),
  max_stops: z.number().int().min(0).max(3),
  earliest_departure_hour: z.number().int().min(0).max(23),
  latest_arrival_hour: z.number().int().min(0).max(23),
  checked_bags_per_pax: z.number().int().min(0).max(3),
  allow_overnight_outbound: z.boolean(),
  max_heavy_rain_prob: z.number().min(0).max(1),
  max_tmax_c: z.number().min(0).max(60),
  max_consecutive_full_days: z.number().int().min(1).max(14),
  activity_free_travel_days: z.boolean(),
});

export const cityPlanSchema = z.object({
  code: z.string().regex(/^[A-Z]{2,5}$/, "2 a 5 letras mayúsculas"),
  airports: z.array(iata).min(1).max(5),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  min_nights: z.number().int().min(1).max(21),
  max_nights: z.number().int().min(1).max(21),
  must_do: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)).max(10),
});

export const tripRequestSchema = z.object({
  // espejo de engine/app/domain/models.py::CASE_KEY_PATTERN (otro runtime)
  case_key: z.string().regex(/^[a-z0-9_]{1,64}$/).nullable(),
  origin_airports: z.array(iata).min(1).max(5),
  cities: z.array(cityPlanSchema).min(1).max(4),
  fixed_order: z.boolean(),
  first_checkin_from: isoDate,
  first_checkin_to: isoDate,
  total_nights_min: z.number().int().min(1).max(60),
  total_nights_max: z.number().int().min(1).max(60),
  pax: z.number().int().min(1).max(9),
  budget_minor: z.number().int().min(0).max(10 ** 10),
  currency: z.literal("USD"),
  constraints: constraintsSchema,
  top_n: z.number().int().min(1).max(10),
});

export type TripRequest = z.infer<typeof tripRequestSchema>;
export type Constraints = TripRequest["constraints"];
```

**`web/lib/money.ts`**

```ts
// Mismo formato que engine/app/domain/money.py::fmt. Opera sobre enteros: sin errores de coma flotante.
export function fmtMinor(minor: number, currency = "USD"): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`monto no entero: ${minor}`);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const units = Math.trunc(abs / 100).toLocaleString("en-US");
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}${currency} ${units}.${cents}`;
}

export function toMinor(units: number): number {
  return Math.round(units * 100);
}

export function minorToUnits(minor: number): number {
  return minor / 100;
}
```

**`web/lib/types.ts`**

```ts
// Forma de search_runs e itineraries.payload (ver engine/app/optimizer/service.py::itinerary_to_dict).
export type RunStatus = "queued" | "extracting" | "optimizing" | "done" | "infeasible" | "failed";

export type Run = {
  id: string;
  status: RunStatus;
  summary: {
    query_plan?: Record<string, number>;
    result_status?: "ok" | "over_budget" | "infeasible";
    best_total_minor?: number | null;
    budget_gap_minor?: number;
    diagnostics?: {
      rejections: Record<string, string[]>;
      infeasible_skeletons: Record<string, string>;
      warnings: string[];
    };
    stats?: Record<string, unknown>;
  };
  error: { code: string; message?: string; node?: string } | null;
  timings: Record<string, string>;
};

export type BreakdownLine = {
  category: "vuelos" | "alojamiento" | "actividades" | "transporte";
  description: string;
  quantity: number;
  unit_minor: number;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  ref: string;
  deeplink: string | null;
};

export type ItineraryPayload = {
  rank: number;
  skeleton_id: string;
  order: string[];
  first_checkin: string;
  nights: Record<string, number>;
  total_minor: number;
  within_budget: boolean;
  currency: string;
  stays: {
    city: string;
    check_in: string;
    check_out: string;
    nights: number;
    lodging: {
      name: string;
      deeplink: string | null;
      cost_minor: number;
      units: { unit_type: string; qty: number; bathrooms: number; bathrooms_source: string; capacity: number }[];
    };
    activities: { date: string; name: string; outdoor: boolean; cost_minor: number; deeplink: string | null }[];
  }[];
  breakdown: {
    lines: BreakdownLine[];
    by_category: Record<string, number>;
    total_minor: number;
    per_pax_minor: number[];
  };
};

export type ItineraryRow = { rank: number; total_minor: number; within_budget: boolean; payload: ItineraryPayload };
```

**`web/lib/engine.ts`**

```ts
import "server-only";

// Única puerta del frontend hacia el motor. ENGINE_API_KEY jamás llega al navegador.
export async function engineFetch(path: string, init: RequestInit = {}) {
  const base = process.env.ENGINE_BASE_URL;
  const key = process.env.ENGINE_API_KEY;
  if (!base || !key) throw new Error("ENGINE_BASE_URL / ENGINE_API_KEY no configuradas");
  return fetch(`${base}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
  });
}
```

**`web/lib/supabase/client.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

// Sesión anónima de Supabase: da un auth.uid() estable para RLS sin pedir registro.
export async function ensureSession(supabase = createClient()) {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return anon.session;
}
```

**`web/lib/supabase/server.ts`**

```ts
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Llamado desde un Server Component: el refresco de sesión lo hace proxy.ts
          }
        },
      },
    },
  );
}
```

**`web/proxy.ts`**

```ts
// Next.js 16: "proxy.ts" (en Next <= 15 este archivo se llama middleware.ts y exporta `middleware`).
// Refresca la sesión de Supabase en cada request para que los Server Components la vean vigente.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

**`web/app/api/trips/route.ts`**

```ts
import { NextResponse } from "next/server";
import { tripRequestSchema } from "@/lib/contracts";
import { engineFetch } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

// POST /api/trips: valida (UX), identifica al usuario y delega en el motor, que crea la corrida y dispara n8n.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "no_session" }, { status: 401 });

  const parsed = tripRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ code: "invalid_request", issues: parsed.error.issues }, { status: 422 });
  }
  const r = await engineFetch("/v1/runs", {
    method: "POST",
    body: JSON.stringify({ trip_request: parsed.data, user_id: user.id }),
  });
  return NextResponse.json(await r.json(), { status: r.status });
}
```

**`web/app/page.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { tripRequestSchema, type Constraints, type TripRequest } from "@/lib/contracts";
import demoCase from "@/lib/demo-case.json";
import { fmtMinor, minorToUnits, toMinor } from "@/lib/money";
import { ensureSession } from "@/lib/supabase/client";

const DEMO: TripRequest = tripRequestSchema.parse(demoCase);

function NumberField(props: { label: string; value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-neutral-600">{props.label}</span>
      <input
        type="number"
        className="rounded border px-2 py-1"
        value={props.value}
        step={props.step ?? 1}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

export default function Home() {
  const router = useRouter();
  const [req, setReq] = useState<TripRequest>(DEMO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setC = <K extends keyof Constraints>(k: K, v: Constraints[K]) =>
    setReq((r) => ({ ...r, constraints: { ...r.constraints, [k]: v } }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail?.code ?? body?.code ?? `HTTP ${res.status}`);
      router.push(`/runs/${body.run_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold">TravelOpt</h1>
        <p className="text-neutral-600">
          Caso de prueba: {req.pax} personas · {req.origin_airports.join("/")} →{" "}
          {req.cities.map((c) => c.code).join(" → ")} · check-in {req.first_checkin_from} a {req.first_checkin_to}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <NumberField label="Presupuesto total (USD)" value={minorToUnits(req.budget_minor)} step={100} min={0}
          onChange={(v) => setReq((r) => ({ ...r, budget_minor: toMinor(v) }))} />
        <NumberField label="Baños mínimos" value={req.constraints.min_bathrooms} min={0} max={10}
          onChange={(v) => setC("min_bathrooms", v)} />
        <NumberField label="Escalas máximas" value={req.constraints.max_stops} min={0} max={3}
          onChange={(v) => setC("max_stops", v)} />
        <NumberField label="Prob. máx. lluvia fuerte (día outdoor)" value={req.constraints.max_heavy_rain_prob}
          step={0.05} min={0} max={1} onChange={(v) => setC("max_heavy_rain_prob", v)} />
        <NumberField label="Días de parque seguidos (máx.)" value={req.constraints.max_consecutive_full_days}
          min={1} max={14} onChange={(v) => setC("max_consecutive_full_days", v)} />
        <NumberField label="Valijas despachadas por persona" value={req.constraints.checked_bags_per_pax}
          min={0} max={3} onChange={(v) => setC("checked_bags_per_pax", v)} />
      </section>

      <p className="text-xs text-neutral-500">
        Modo fixture: los datos de prueba cubren check-in 08–09/07/2027. Presupuesto actual {fmtMinor(req.budget_minor)}.
      </p>

      <div className="flex gap-3">
        <button className="rounded bg-black px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={submit}>
          {busy ? "Optimizando…" : "Optimizar itinerario"}
        </button>
        <button className="rounded border px-4 py-2" disabled={busy} onClick={() => setReq(DEMO)}>
          Restaurar caso Orlando + NYC
        </button>
      </div>
      {error && <p role="alert" className="text-red-700">Error: {error}</p>}
    </main>
  );
}
```

**`web/app/runs/[id]/page.tsx`**

```tsx
import RunView from "@/components/RunView";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunView runId={id} />;
}
```

**`web/components/RunView.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import BreakdownTable from "@/components/BreakdownTable";
import Funnel from "@/components/Funnel";
import { fmtMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import type { ItineraryRow, Run } from "@/lib/types";

const STEPS = ["queued", "extracting", "optimizing", "done"] as const;
const TERMINAL = new Set(["done", "infeasible", "failed"]);

export default function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [missing, setMissing] = useState(false);
  const [its, setIts] = useState<ItineraryRow[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let stopped = false;

    async function load() {
      const { data } = await supabase
        .from("search_runs").select("id,status,summary,error,timings").eq("id", runId).single();
      if (!stopped) {
        if (data) setRun(data as Run);
        else setMissing(true); // inexistente o de otro usuario: RLS no la devuelve
      }
      return data as Run | null;
    }

    // Realtime como camino principal; sondeo cada 3 s como respaldo hasta estado terminal.
    const channel = supabase
      .channel(`run-${runId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "search_runs", filter: `id=eq.${runId}` },
        (payload) => setRun(payload.new as Run))
      .subscribe();
    load();
    const timer = setInterval(async () => {
      const r = await load();
      if (!r || TERMINAL.has(r.status)) clearInterval(timer);
    }, 3000);

    return () => {
      stopped = true;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [runId]);

  useEffect(() => {
    if (run?.status !== "done") return;
    createClient()
      .from("itineraries").select("rank,total_minor,within_budget,payload").eq("run_id", runId).order("rank")
      .then(({ data }) => setIts((data ?? []) as ItineraryRow[]));
  }, [run?.status, runId]);

  if (!run) {
    return (
      <main className="p-4" data-testid="run-missing">
        {missing ? "Corrida no encontrada o sin permiso para verla." : "Cargando corrida…"}
      </main>
    );
  }
  const best = its[0]?.payload;
  const s = run.summary;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4">
      <ol className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((st) => (
          <li key={st} className={`rounded px-2 py-1 ${run.timings[st] ? "bg-green-100" : "bg-neutral-100"}`}>{st}</li>
        ))}
        <li data-testid="run-status" className="ml-auto font-mono">{run.status}</li>
      </ol>

      {run.status === "failed" && (
        <p role="alert" className="text-red-700">Falló en {run.error?.node ?? "?"}: {run.error?.code}</p>
      )}
      {run.status === "infeasible" && (
        <p role="alert">Ninguna combinación cumple las restricciones. Revisá el embudo de descartes.</p>
      )}

      {best && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">
            Óptimo: <span data-testid="best-total">{fmtMinor(best.total_minor)}</span>
          </h2>
          <p className="text-sm text-neutral-600">
            {best.order.join(" → ")} · check-in {best.first_checkin} ·{" "}
            {Object.entries(best.nights).map(([c, n]) => `${c} ${n} noches`).join(" · ")} · por persona{" "}
            <span data-testid="per-pax">{best.breakdown.per_pax_minor.map((x) => fmtMinor(x)).join(" / ")}</span>
          </p>
          {s.result_status === "over_budget" && (
            <p data-testid="over-budget" className="text-amber-700">
              Supera el presupuesto por {fmtMinor(s.budget_gap_minor ?? 0)}
            </p>
          )}
          <BreakdownTable lines={best.breakdown.lines} byCategory={best.breakdown.by_category} total={best.total_minor} />
          <h3 className="pt-4 font-semibold">Itinerario</h3>
          {best.stays.map((st) => (
            <div key={st.city} className="text-sm">
              <b>{st.city}</b> {st.check_in} → {st.check_out}: {st.lodging.name} (
              {st.lodging.units.map((u) => `${u.qty}× ${u.unit_type}, ${u.bathrooms} baño(s)${u.bathrooms_source === "inferred_per_room" ? " inferido" : ""}`).join(" + ")})
              <ul className="ml-4 list-disc">
                {st.activities.map((a) => <li key={a.date + a.name}>{a.date}: {a.name}</li>)}
              </ul>
            </div>
          ))}
        </section>
      )}

      {its.length > 1 && (
        <section>
          <h3 className="font-semibold">Alternativas</h3>
          <ul className="text-sm">
            {its.slice(1).map((it) => (
              <li key={it.rank}>#{it.rank} {it.payload.skeleton_id}: {fmtMinor(it.total_minor)} (+{fmtMinor(it.total_minor - its[0].total_minor)})</li>
            ))}
          </ul>
        </section>
      )}

      {s.diagnostics && <Funnel diagnostics={s.diagnostics} />}
    </main>
  );
}
```

**`web/components/BreakdownTable.tsx`**

```tsx
import { fmtMinor } from "@/lib/money";
import type { BreakdownLine } from "@/lib/types";

// Los deeplinks vienen de proveedores externos: solo se renderizan si son https (bloquea javascript:, data:, etc.).
export function safeHref(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u).protocol === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
}

export default function BreakdownTable({ lines, byCategory, total }: {
  lines: BreakdownLine[]; byCategory: Record<string, number>; total: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="breakdown">
        <thead>
          <tr className="border-b text-left">
            <th>Concepto</th><th className="text-right">Cant.</th><th className="text-right">Subtotal</th>
            <th className="text-right">Impuestos</th><th className="text-right">Total</th><th />
          </tr>
        </thead>
        <tbody>
          {lines.map((ln, i) => {
            const href = safeHref(ln.deeplink);
            return (
              <tr key={i} className="border-b">
                <td>{ln.description}</td>
                <td className="text-right">{ln.quantity}</td>
                <td className="text-right">{fmtMinor(ln.subtotal_minor)}</td>
                <td className="text-right">{fmtMinor(ln.tax_minor)}</td>
                <td className="text-right">{fmtMinor(ln.total_minor)}</td>
                <td>{href && <a className="underline" href={href} target="_blank" rel="noopener noreferrer">Comprar</a>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {Object.entries(byCategory).map(([cat, v]) => (
            <tr key={cat}><td colSpan={4} className="text-right capitalize">{cat}</td><td className="text-right">{fmtMinor(v)}</td><td /></tr>
          ))}
          <tr className="font-semibold"><td colSpan={4} className="text-right">TOTAL</td><td className="text-right">{fmtMinor(total)}</td><td /></tr>
        </tfoot>
      </table>
    </div>
  );
}
```

**`web/components/Funnel.tsx`**

```tsx
import type { Run } from "@/lib/types";

const REASONS: Record<string, string> = {
  "flight.too_many_stops": "Vuelos con más escalas que el máximo",
  "flight.departs_too_early": "Vuelos que salen antes de la hora mínima",
  "flight.arrives_too_late": "Vuelos que llegan después de la hora máxima",
  "flight.insufficient_seats": "Vuelos sin asientos para todo el grupo",
  "lodging.bathrooms": "Alojamientos con menos baños que el mínimo",
  "lodging.capacity": "Alojamientos sin capacidad para el grupo",
  "lodging.bedrooms": "Alojamientos con menos dormitorios que el mínimo",
  "lodging.min_nights": "Alojamientos con estadía mínima mayor a la planificada",
  "lodging.short_term_not_legal": "Alquileres temporarios no legales (p. ej. NYC Local Law 18)",
  "activity.weather_rain": "Días-actividad outdoor descartados por lluvia",
  "activity.weather_heat": "Días-actividad outdoor descartados por calor",
};

export default function Funnel({ diagnostics }: { diagnostics: NonNullable<Run["summary"]["diagnostics"]> }) {
  const rows = Object.entries(diagnostics.rejections);
  const skel = Object.entries(diagnostics.infeasible_skeletons);
  return (
    <section className="text-sm" data-testid="funnel">
      <h3 className="font-semibold">Embudo de factibilidad</h3>
      <ul>
        {rows.map(([reason, ids]) => (
          <li key={reason}>{REASONS[reason] ?? reason}: <b>{ids.length}</b></li>
        ))}
      </ul>
      {skel.length > 0 && (
        <p className="mt-2">Combinaciones de fechas descartadas: {skel.map(([id, why]) => `${id} (${why})`).join("; ")}</p>
      )}
    </section>
  );
}
```

## 4.5 Tests

**`web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

**`web/test/unit.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tripRequestSchema } from "../lib/contracts";
import { fmtMinor, toMinor } from "../lib/money";
import demo from "../lib/demo-case.json";

const root = resolve(process.cwd(), ".."); // npm test corre desde web/

describe("money", () => {
  it("formatea igual que el motor", () => {
    expect(fmtMinor(2008362)).toBe("USD 20,083.62");
    expect(fmtMinor(5)).toBe("USD 0.05");
    expect(fmtMinor(-63638)).toBe("-USD 636.38");
  });
  it("convierte unidades a centavos enteros", () => {
    expect(toMinor(21000)).toBe(2100000);
    expect(toMinor(0.1 + 0.2)).toBe(30);
  });
});

describe("contrato", () => {
  it("el caso demo del frontend es idéntico al fixture del motor", () => {
    const engineCase = JSON.parse(readFileSync(resolve(root, "engine/fixtures/orlando_nyc_5pax/trip_request.json"), "utf8"));
    expect(demo).toEqual(engineCase);
  });
  it("zod acepta el fixture", () => {
    expect(tripRequestSchema.safeParse(demo).success).toBe(true);
  });
  it("zod cubre todas las propiedades del JSON Schema de Pydantic", () => {
    const schema = JSON.parse(readFileSync(resolve(root, "contracts/TripRequest.schema.json"), "utf8"));
    expect(Object.keys(tripRequestSchema.shape).sort()).toEqual(Object.keys(schema.properties).sort());
  });
});
```

**`web/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
```

**`web/e2e/golden.spec.ts`**

```ts
// Requiere motor (8000), n8n (5678) y Supabase local corriendo. Ver fase_4_frontend.md.
import { expect, test } from "@playwright/test";

test("caso Orlando + NYC llega al óptimo exacto", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
  await expect(page.getByTestId("best-total")).toHaveText("USD 20,083.62");
  await expect(page.getByTestId("per-pax")).toHaveText(
    "USD 4,016.73 / USD 4,016.73 / USD 4,016.72 / USD 4,016.72 / USD 4,016.72");
  await expect(page.getByTestId("funnel")).toContainText("Alojamientos con menos baños que el mínimo");
});

test("3 baños mínimos cambia el óptimo y excede el presupuesto", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Baños mínimos").fill("3");
  await page.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
  await expect(page.getByTestId("best-total")).toHaveText("USD 21,636.38");
  await expect(page.getByTestId("over-budget")).toContainText("USD 636.38");
});

test("sin escalas no hay solución factible", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Escalas máximas").fill("0");
  await page.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("infeasible", { timeout: 60_000 });
});
```

## 4.6 Desarrollo

```bash
npm run dev
```

Abrir http://localhost:3000 → *Optimizar itinerario*. La URL pasa a `/runs/<uuid>`, los pasos se iluminan uno a uno y aparece el óptimo.

---

## Checkpoints de validación (todos deben dar OK)

**Estado previo:** `test/unit.test.ts` dio 5/5 OK con vitest 3 y zod 4. **No se ejecutaron**: el build, typecheck y lint de Next.js, Playwright ni la integración con Supabase Auth y Realtime. Esta fase es su primera ejecución real.

| ID | Check | Cómo | OK si… |
|---|---|---|---|
| CP-4.1 | Calidad estática | `npm run lint` · `npm run typecheck` | Sin errores |
| CP-4.2 | Unit + contrato | `npm run test` | 5 tests OK. Si falla "zod cubre todas las propiedades", el contrato divergió: corregir `lib/contracts.ts` |
| CP-4.3 | Build | `npm run build` | Build OK |
| CP-4.4 | Bundle sin secretos | `uv run python scripts/gate.py 4` (check "sin secretos en bundle") | OK: ningún valor server-only de `.env.local` ni `sb_secret_` en `.next/static` |
| CP-4.5 | E2E golden | `npx playwright test` | 3/3: total **USD 20,083.62** y por persona `4,016.73 ×2 / 4,016.72 ×3`; 3 baños → **USD 21,636.38** y excede por **USD 636.38**; 0 escalas → `infeasible` |
| CP-4.6 | El navegador no habla con el motor | DevTools → Network durante una corrida | Solo `POST /api/trips` hacia el propio dominio. Ninguna request a `:8000` ni header `Authorization: Bearer` del motor |
| CP-4.7 | RLS entre usuarios | Abrir la URL `/runs/<id>` en una ventana de incógnito (otra sesión anónima) | Muestra "Corrida no encontrada o sin permiso para verla." |
| CP-4.8 | Realtime | Con el sondeo deshabilitado temporalmente (`setInterval` comentado) | Los estados igual avanzan solos hasta `done` |
| CP-4.9 | Explicabilidad | Ver la corrida golden | El embudo muestra baños (6), alquiler ilegal (4), lluvia (7), etc., y los 2 esqueletos descartados. En NYC se lee "baño(s) inferido" |
| CP-4.10 | Enlaces de compra | Click en "Comprar" | Abren en otra pestaña con `rel="noopener noreferrer"` |
| CP-4.11 | Mobile | Ancho de 375 px | Sin scroll horizontal de la página (la tabla se desplaza dentro de su contenedor) |
| CP-4.12 | Gate | `uv run python scripts/gate.py 4` | `GATE FASE 4: OK` |
| CP-4.13 | Rate limit | Crear corridas seguidas con el mismo `user_id` (2 sin terminar, o 10 en una hora) | El motor responde **429**: un `user_id` con ≥ 2 corridas no terminales o ≥ 10 en la última hora no puede crear otra |

> **CP-4.13 se implementa en esta fase** (hallazgo A4 de la auditoría de seguridad del 2026-10-27): el límite vive en el motor, en `POST /v1/runs`, y `/api/trips` debe propagar el 429 al navegador con un mensaje claro.

> Al cerrar: actualizar la tabla *Estado* de `master_plan.md` y hacer un commit `fase-4: gate OK`.
