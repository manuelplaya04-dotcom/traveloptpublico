# TravelOpt — reglas para Claude

Plataforma de optimización logística y financiera de viajes. Arquitectura y roadmap en `master_plan.md`;
instrucciones por etapa en `fase_N_*.md`.

## Directivas core (obligatorias)
- **Leer `project_guidelines.md` antes de cualquier cambio** en scripts, nodos de n8n o componentes de interfaz, y
  verificar el cambio contra sus 4 normas: seguridad OWASP, clean code, rendimiento y resiliencia.
- Al cerrar un cambio, indicar qué normas toca y actualizar la tabla "Estado de cumplimiento" si cambia algo.
- Si una norma choca con un invariante de este archivo, gana el invariante; la tensión se registra como decisión
  explícita en `project_guidelines.md`.

## Regla de oro: gates de fase
- No empezar la fase N+1 hasta que `uv run python scripts/gate.py N` imprima `GATE FASE N: OK` **y** los checks
  manuales del documento de la fase estén tildados. Si un check falla, se arregla antes de seguir.
- Al terminar una fase, actualizar la tabla "Estado" de `master_plan.md` con fecha y commit.

## Invariantes del dominio (no negociables)
- Dinero: `int` en centavos (`*_minor`). Nunca `float`. Impuestos en basis points, redondeo half-up por línea
  (`engine/app/domain/money.py`). Toda calculadora debe conciliar al centavo con el total del solver.
- Determinismo: misma entrada, misma salida (CP-SAT con `num_workers = 1` y desempates explícitos).
- Restricciones duras (baños, escalas, clima, legalidad) se aplican como filtros con motivo registrado en el
  embudo de factibilidad. No se "relajan" en silencio.
- El caso `orlando_nyc_5pax` es el golden: óptimo USD 20,083.62. Si un cambio lo mueve, es un bug o una
  decisión explícita que actualiza `engine/fixtures/orlando_nyc_5pax/expected.json` en el mismo commit.
- El modelo canónico (`engine/app/domain/models.py`) es el contrato. Los proveedores se adaptan a él.

## Arquitectura en una línea
Next.js (Vercel) -> motor FastAPI `POST /v1/runs` -> n8n (webhook) -> motor `/plan`, `/extract/{kind}` x5 en
paralelo, `/optimize` -> Supabase (único escritor: el motor) -> Realtime -> Next.js.
- **Producción (desde 2026-11-01): sin n8n.** `ORCHESTRATOR=inprocess`: el motor ejecuta los mismos pasos en proceso
  (`orchestrate` + `reaper_loop` en `engine/app/api/main.py`), en Render Free. Local y tests siguen con n8n por defecto.

## Uso de MCP (estándar del proyecto)
- `travelopt-devtools`: herramienta preferida para probar. `run_fixture_inprocess` (sin n8n),
  `e2e_via_n8n` (flujo completo), `n8n_execution` (diagnóstico por nodo). Solo opera contra hosts locales.
- `supabase-local`: inspeccionar esquema y datos locales. **Prohibido** hacer DDL por MCP: todo cambio de
  esquema es un archivo nuevo en `supabase/migrations/` (`npx supabase migration new <nombre>`), probado con
  `npx supabase db reset` + `npx supabase test db`.
- `supabase-staging` (scope local, `read_only=true`): solo lectura y logs. Nunca producción por MCP.
- `n8n` (MCP de instancia, scope local): descubrir/ejecutar workflows expuestos. Los workflows se versionan
  como JSON en `n8n/workflows/`.

## Comandos
- Motor: `cd engine && uv run pytest -q` · `uv run python -m app.cli orlando_nyc_5pax` ·
  `uv run uvicorn app.api.main:app --reload --port 8000`
- Base de datos: `npx supabase start | status | db reset | test db`
- n8n: `docker compose up -d n8n` · UI en http://localhost:5678
- Web: `cd web && npm run dev | lint | typecheck | test | build` · `npx playwright test`

## Secretos
- Nunca leer ni imprimir `.env`, `web/.env.local` ni claves. Usar `.env.example` como referencia.
- Variables con `NEXT_PUBLIC_` son públicas por definición: jamás poner ahí una clave secreta.
- El navegador solo usa la publishable key de Supabase; el motor usa `DATABASE_URL`; n8n solo conoce
  `ENGINE_API_KEY` y el secreto del webhook.
