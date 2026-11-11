# Estado del proyecto TravelOpt: punto de guardado

**Última actualización:** 2026-10-28 (Fases 0–4 y rediseño 4b cerrados; Fase 5 preparada en local, faltan cuentas)
**Repositorio:** `C:\PROYECOTS\VIAJES.COM` (git, rama `main`)

---

## 1. Resumen en 30 segundos

- **`GATE FASE 0: OK` y `GATE FASE 1: OK`.** Supabase local y n8n 2.44.7 corren en Docker. El motor se probó contra Postgres real.
- Primera ejecución real de la migración, de pgTAP (8/8) y de `PgRepository`/`PgCache`: todo OK después de dos ajustes chicos (ver §4).
- Golden intacto: `run_fixture_inprocess` contra Postgres da `verdict: OK`, con un óptimo de **USD 20,083.62** (`2008362`). La suite completa da **343 OK** en Python 3.12.15.
- **Te faltan 3 checks de la Fase 0** (§3): cuenta owner de n8n, API key de n8n y la prueba del `deny` de `.env` en una sesión nueva.
- **Commit propuesto, sin hacer:** `fase-1: gate OK`.

## 2. Checklist del proyecto

| Fase | Estado | Próxima acción |
|---|---|---|
| 0 · Entorno + MCP | ✅ gate · ✅ 11/11 | — |
| 1 · Extracción | ✅ gate · ✅ checks (CP-1.13 en "fixture hasta decidir") | Completar el ADR cuando llegue la investigación de proveedores |
| 2 · n8n | ✅ gate · ✅ 10/10 (§7b) | — |
| 3 · Algoritmo | ✅ gate · ✅ 12/12 (§7c) | — |
| 4 · Frontend | ✅ gate · ✅ 13/13 (§7d) | — |
| 5 · Deploy | ⬜ **Siguiente** | Ver pendientes de §8b y `turbopack.root` |

Los gates se corren con `uv run python scripts/gate.py N`.

## 3. Checks manuales

**Fase 0**

| ID | Resultado |
|---|---|
| CP-0.1 Docker | ✅ 29.9.2 |
| CP-0.2 uv + 3.12 | ✅ uv 0.13.5, cpython 3.12.15 |
| CP-0.3 Supabase | ✅ API 54321, DB 54322, Studio 54323 y publishable key visible |
| CP-0.4 Anónimas | ✅ `enable_anonymous_sign_ins = true`; `stop` + `start` sin errores |
| CP-0.5 n8n owner | ⏳ **Usuario:** crear la cuenta owner en http://localhost:5678. `N8N_VERSION=2.44.7` ya está fijada en `.env` |
| CP-0.6 API de n8n | ⏳ **Usuario:** *Settings → n8n API* → crear la key y pegarla en `N8N_API_KEY` del `.env` (no pasársela a Claude). Después, pedirle a Claude `n8n_executions` |
| CP-0.7 MCP | ✅ Por handshake MCP: `travelopt-devtools` (stdio, 9 herramientas) y `supabase-local` (HTTP, `initialize` + `tools/list`). El CLI `claude` no está en el PATH, así que `claude mcp list` no se corrió |
| CP-0.8 Guard | ✅ `engine_health` → `httpx.ConnectError` contra `localhost:8000` (el SDK `mcp` 2.x le muestra al modelo solo "Error executing tool") |
| CP-0.9 Deny `.env` | ✅ Verificado en vivo con sondas que no leen secretos: `Read` de un `.env` → denegado por permisos; `echo` que menciona `.env` en Bash y en PowerShell → bloqueado por el hook `.claude/hooks/block-env-read.mjs`; un comando normal (`git status`) corre sin problema |
| CP-0.10 `.env` ignorado | ✅ Solo aparece como `!! .env` |
| CP-0.11 Gate | ✅ `GATE FASE 0: OK` |

**Fase 1**: todo hecho con `travelopt-devtools` y `supabase-local`

| ID | Resultado |
|---|---|
| CP-1.1 Migración | ✅ |
| CP-1.2 pgTAP | ✅ 8/8 |
| CP-1.3 Advisors | ✅ Por `get_advisors` (security): solo 3 INFO `rls_enabled_no_policy` en `api_cache`, `api_usage` y `run_offers`. Es intencional: son tablas solo del backend |
| CP-1.4 Tests | ✅ 29 passed |
| CP-1.5 Ruff | ✅ All checks passed! |
| CP-1.6 Contrato | ✅ Schemas regenerados, idénticos a los verificados |
| CP-1.7 Extracción | ✅ 15 / 48 / 57 / 14 / 2. `optimize` da **200** (no 501) porque el código de la Fase 3 ya está en el repo |
| CP-1.8 Persistencia | ✅ Mismos conteos en `run_offers`; `status = extracting` en una corrida sin `optimize` |
| CP-1.9 Idempotencia | ✅ `flights` sigue en 15 |
| CP-1.10 Clima + caché | ✅ 1ª: `api_calls = 2`; 2ª: `0` y `cache_hits = 2`. `source = open_meteo_climatology:2016-2025`; ORL con lluvia entre 0,186 y 0,329 y `tmax` entre 31,6 y 31,8 |
| CP-1.11 Live | ✅ 4 × 501 `provider_not_configured`; clima OK. La corrida termina `infeasible` |
| CP-1.12 Claves en logs | ✅ 0 |
| CP-1.13 ADR | ⏳ `docs/adr/0001-proveedores.md` con "fixture hasta decidir" y la matriz vacía, a completar con la investigación externa |
| CP-1.14 Gate | ✅ `GATE FASE 1: OK` |

## 4. Cambios hechos en la primera ejecución real

Los documentos se actualizaron igual que el código, así que sus bloques siguen siendo textuales.

1. **Ruff 0.17** activa por defecto reglas nuevas (B, UP, SIM y PLR): daba 17 errores. Se fijó `[tool.ruff.lint] select = ["E4", "E7", "E9", "F"]` en `engine/pyproject.toml` y se renombró `l` → `lo` en `collect_offers` (`engine/app/providers/base.py`, E741).
2. **psycopg async en Windows:** sin `--reload`, uvicorn usa `ProactorEventLoop` y el pool no conecta. Antes eso pasaba en silencio: `/healthz` daba 200 y la DB no funcionaba. Ahora `PgRepository.open()` usa `pool.open(wait=True, timeout=10)` y falla al arrancar. En Windows el motor se levanta con el comando de `CLAUDE.md`: `uv run uvicorn app.api.main:app --reload --port 8000`.
3. `supabase/config.toml`: `project_id = "travelopt"` (la carpeta se llama `VIAJES.COM`) y `enable_anonymous_sign_ins = true`.

## 5. Detalles pendientes

- **Python de uv dentro de la app de Claude.** La app corre empaquetada (MSIX), así que el Python 3.12.15 que instaló uv quedó virtualizado en `AppData\Local\Packages\Claude_…\LocalCache\Roaming\uv\python`. Desde una terminal fuera de la app, los `.venv` apuntan a una ruta que no existe y uv los recrea. Solución: correr una vez `uv python install 3.12` desde tu propia terminal.
- La imagen de `uv` en `engine/Dockerfile` sigue en `latest` (Fase 5). `N8N_VERSION` ya quedó fijada en 2.44.7.
- El proyecto de Docker Compose se llama `viajescom` porque toma el nombre de la carpeta. No afecta en nada.
- Al importar los workflows (Fase 2), volver a elegir las credenciales en cada nodo: los IDs dicen `REEMPLAZAR`.
- Completar `docs/adr/0001-proveedores.md` con la investigación externa (Amadeus Self-Service cerró el 17/07/2026).
- Producción con sesiones anónimas exige CAPTCHA (Turnstile): está en la Fase 5 §5.1.

## 6. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Repo (documentos + código) | `C:\PROYECOTS\VIAJES.COM` |
| Secretos | `.env` (ignorado por git; `N8N_ENCRYPTION_KEY` conviene respaldarla en un gestor de contraseñas) |
| Servicios locales | Supabase (`npx supabase start/stop`), n8n (`docker compose up -d n8n`), motor en `:8000` (`--reload`) |

## 7. Cómo retomar

1. Hacer CP-0.5 y CP-0.6 (§3). CP-0.9 ya quedó verificado.
2. Aprobar el commit `fase-1: gate OK`.
3. Seguir con `fase_2_orquestacion_n8n.md`.


## 7b. Fase 2 (n8n), 2026-10-27

| CP | Resultado |
|---|---|
| CP-2.1 Webhook protegido | ✅ Sin header o con secreto incorrecto → 403 |
| CP-2.2 Flujo completo | ✅ `done` en ~1,5 s, golden USD 20,083.62 (`verdict: OK`) |
| CP-2.3 Concurrencia | ✅ Extract 2.192 ms con 5 × 2 s de retardo (en serie serían ~10 s) |
| CP-2.4 Webhook duplicado | ✅ Route plan corta en silencio; la corrida sigue `done` |
| CP-2.5 Falla de extracción | ✅ Modo `live` → `failed`, `node: "Gate"`, `extraction_failed` + 501 |
| CP-2.6 Motor caído + reaper | ✅ Plan agota reintentos, Mark failed no corta el flujo; con el motor de vuelta, WF-03 marca `stale_run` |
| CP-2.7 Mantenimiento | ✅ WF-03 corre cada 5 min con `success` (los 2 errores previos fueron con la credencial mal cargada y con el motor apagado a propósito) |
| CP-2.8 Error workflow | ✅ WF-02 asignado en WF-01 y WF-03 |
| CP-2.9 Versionado | ✅ Los JSON del repo quedan con IDs `REEMPLAZAR`: los IDs de credenciales y del error workflow son propios de cada instancia de n8n |
| CP-2.10 Gate | ✅ `GATE FASE 2: OK` |

## 7c. Fase 3 (algoritmo), 2026-10-27

| CP | Resultado |
|---|---|
| CP-3.1 Suite | ✅ 404 passed (el doc dice 343; los 61 extra son de seguridad y Fase 2) |
| CP-3.2 CLI = golden | ✅ Idéntico a §3.6 salvo `elapsed_ms` |
| CP-3.3 Oráculo | ✅ `--engine brute`: mismo top-3 20,083.62 / 20,423.78 / 21,108.78 |
| CP-3.4 Planilla | ✅ Recalculada en centavos: 2008362; los 4 esqueletos dan 2008362 / 2042378 / 2110878 / 2114862 |
| CP-3.5 Variantes · CP-3.6 Determinismo | ✅ `-k "variant or deterministic"`: 7 passed |
| CP-3.7 Rendimiento | ✅ 214 ms (< 2000) |
| CP-3.8 E2E sin n8n | ✅ `verdict: OK` |
| CP-3.9 E2E vía n8n | ✅ `verdict: OK`, timings queued → extracting → optimizing → done |
| CP-3.10 Persistencia | ✅ 3 filas 2008362 / 2042378 / 2110878 con `bd = total_minor` |
| CP-3.11 Embudo | ✅ 2 claves: los esqueletos 6-6 (`actividades_infactibles:ORL`) |
| CP-3.12 Gate | ✅ `GATE FASE 3: OK` |

CP-3.10/3.11 se consultaron con `docker exec supabase_db_travelopt psql`, porque el MCP `supabase-local` no conectó en esta sesión.

**Lecciones de la instancia local (Fase 2):**
- Importar desde JSON deja los nodos apuntando a `REEMPLAZAR`. La UI de n8n 2.44 los muestra como asignados por nombre, pero no los guarda; hubo que poner los IDs reales.
- Error típico en la credencial `Engine API key`: el valor tiene que ser `Bearer` + **un espacio** + la clave. Sin el espacio, el motor responde 401.
- Docker Desktop se cerró dos veces en la sesión. Si n8n o Supabase no responden, primero hay que abrir Docker Desktop.

## 7d. Fase 4 (frontend), 2026-10-27

| CP | Resultado |
|---|---|
| CP-4.1 Lint + typecheck | ✅ |
| CP-4.2 Unit + contrato | ✅ 5/5 (vitest 5) |
| CP-4.3 Build | ✅ Next 16.4.3 (`/runs/[id]` con `<Suspense>` por `cacheComponents`) |
| CP-4.4 Bundle sin secretos | ✅ `ENGINE_API_KEY` ausente. El check daba falso positivo con el prefijo `sb_secret_` del código de supabase-js; ahora busca una key real |
| CP-4.5 E2E golden | ✅ 3/3 (20,083.62 · 3 baños 21,636.38 / excede 636.38 · 0 escalas `infeasible`) |
| CP-4.6 Navegador no habla con el motor | ✅ Solo `POST /api/trips` + Supabase; nada a `:8000` |
| CP-4.7 RLS entre usuarios | ✅ Sin sesión y con otra sesión anónima: "Corrida no encontrada o sin permiso para verla." |
| CP-4.8 Realtime | ✅ Con los sondeos bloqueados (Playwright `route.abort`), el 1º devolvió `optimizing` y `done` llegó por WebSocket |
| CP-4.9 Explicabilidad | ✅ Embudo 6 / 4 / 7, 2 esqueletos, "baño(s) inferido" |
| CP-4.10 Enlaces de compra | ✅ 19 enlaces, todos https con `target=_blank` y `rel="noopener noreferrer"` |
| CP-4.11 Mobile 375 px | ✅ Página 375 px; la tabla (640 px) se desplaza dentro de su contenedor |
| CP-4.12 Gate | ✅ `GATE FASE 4: OK` |
| CP-4.13 Rate limit | ✅ 429 por usuario (2 activas / 10 por hora) y global (20 activas); atómico en Postgres |

Ajustes de UI hechos en la verificación: contraste en modo oscuro (pasos, botón, textos), tabla con ancho mínimo y montos sin cortes, `body` sin `flex` (estiraba `main`), título "TravelOpt" y `lang="es"`.

Nota: en el panel del navegador de la app, si el panel está oculto la página corre en segundo plano y la hidratación puede no ocurrir. No es un bug: en Chromium headless hidrata siempre.

## 8. Seguridad (auditoría 2026-10-27)

**Corregido** (suite Python: 403 OK, 343 anteriores y 60 nuevos; golden intacto en `2008362`):

| Hallazgo | Corrección |
|---|---|
| DoS por combinatoria | Cotas en `CityPlan` y `TripRequest` (aeropuertos IATA, noches 1–21 por ciudad y 1–60 en total, `budget_minor` ≤ 10¹⁰, `must_do` ≤ 10) y tope en `_window`: ventana de check-in ≤ 31 días y ≤ 20 000 combinaciones. Mismo rango en `web/lib/contracts.ts` (zod) |
| XSS por `deeplink` (`javascript:`) | El modelo solo acepta `https` con host y sin credenciales; `BreakdownTable` renderiza el enlace solo si `safeHref` lo valida |
| Path traversal por `case_key` | Patrón `[a-z0-9_]{1,64}` en el modelo, en la ruta `/v1/dev/runs/{case_key}` y en `FixtureProvider` (que además resuelve la ruta y exige que quede dentro de `fixtures/`) |
| Filtración de internos en errores | `error.message` guarda solo el nombre de la excepción y el detalle va al log (`travelopt.engine`); `httpx` en WARNING; `FailIn` acotado (64 / 500 / 64); `require_key` compara bytes (un header no ASCII daba 500); cuerpo ≤ 64 KiB (413) |
| Fallar abierto | `ENV` por defecto es `production`: sin `ENV` explícito no existen las rutas `/v1/dev/*` ni `run-all` |
| n8n | Puerto solo en `127.0.0.1`, `/workflows` en solo lectura, `N8N_VERSION` obligatoria, `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, URL del motor literal en WF-01 y WF-03, `run_id` validado como UUID y sin overrides de guardado de ejecuciones |
| Devtools MCP | `case_key` y `mode` validados, `run_id` / `execution_id` / `path` escapados en las URLs y `timeout_s` ≤ 300 |
| CI y repo | `permissions` mínimos en `ci.yml`; `.gitignore` con `.claude/settings.local.json`, `.vercel/` y `*.pem` |
| Permisos de Claude (aprobado por el usuario) | `deny` de `Read`/`Edit` para `**/.env`, `.env.local`, `.env.*.local`, `.env.production/.development/.staging/.test` y `supabase/.temp/**`; `ask` para `Edit(.claude/**)`; hook `PreToolUse` (Bash y PowerShell, *fail-closed*) que bloquea comandos que mencionen un `.env` salvo `.env.example`. Probado: 12/12 casos simulados y bloqueo en vivo |

**Pendiente**

| Qué | Cuándo / quién |
|---|---|
| **A4 · Rate limit** por `user_id` (429 con ≥ 2 corridas no terminales o ≥ 10 en la última hora) | Fase 4, CP-4.13 |
| **Supabase local escucha en la red local** (los puertos 54321–54324 están publicados en `0.0.0.0`) | Requiere una regla de firewall que crea el usuario |
| Fijar las acciones de CI por SHA y bajas **B1–B4** restantes | Fase 5 |

**Límites conocidos:** el tope de 64 KiB se evalúa por `Content-Length`; un cuerpo `chunked` sin esa cabecera no se corta en el motor, así que en producción también hay que limitarlo en el proxy. Los JSON de `n8n/workflows/` ya traen los cambios, pero se aplican al importarlos (hoy la instancia local no tiene workflows importados).

### 8b. Revisión de seguridad de la Fase 4 (2026-10-27, commit `7286f11`)

Corregido: rate limit atómico (probado con 3 pedidos simultáneos → 202, 202, 429), tope global de 20 corridas activas, CSRF/tamaño/JSON en `/api/trips`, https obligatorio hacia el motor, `runId` solo UUID, headers de seguridad (CSP, frame-ancestors, nosniff, HSTS en prod). `npm audit` y `pip-audit`: 0 vulnerabilidades.

Pendiente para la Fase 5:
- CAPTCHA (Turnstile) en el alta anónima: Supabase limita 30 por hora e IP, y el tope global evita la saturación, pero un abusador puede ocupar el cupo.
- CSP con nonce en vez de `'unsafe-inline'` en scripts.

### 8c. Revisión de seguridad 2026-10-28

Corregido: el motor ya no publica `/docs`, `/redoc` ni `/openapi.json` (solo `/v1/dev/openapi.json` en local, con key);
`/healthz` fuera de local responde solo `{"ok": true}`; el carrito guarda solo ids en el navegador y recalcula costos
con las opciones reales (precios adulterados se ignoran); Dockerfile con versiones fijas y `.dockerignore`; CI con
actions fijadas por SHA. Sin secretos en el árbol ni en el historial; `npm audit` y `pip-audit` sin vulnerabilidades.

Pendientes que dependen de cuentas: CAPTCHA (Turnstile) en el alta anónima, CSP con nonce, 2FA y hardening de n8n en
producción, completar responsable y contacto en `web/lib/legal.ts` y revisar el texto legal con un abogado.

### 8d. Clima (2026-10-28)

El modo de prueba usa clima del fixture (datos de ejemplo). El detalle "Ver más" usa datos reales de Open-Meteo
(histórico de 10 años para las fechas exactas + pronóstico de 7 días) vía `GET /v1/weather/insights`. Open-Meteo es
gratuito para uso no comercial; para un sitio comercial hay que contratar su plan (o usar otra fuente) antes de publicar.
