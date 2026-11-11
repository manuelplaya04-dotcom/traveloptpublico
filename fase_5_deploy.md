# Fase 5: despliegue a producción

**Objetivo:** base de datos en producción con RLS verificada, motor y n8n desplegados en la misma región, y el frontend en Vercel con los **secretos fuera del código y fuera del navegador**.
**Requisito previo:** `GATE FASE 4: OK`, repo en GitHub con CI en verde.
**Salida:** producción operativa, smoke tests OK, rollback probado y secretos auditados.

> **Cambio 2026-11-01 (costo cero):** el motor va a **Render Free** con `render.yaml` y **sin n8n en producción**
> (`ORCHESTRATOR=inprocess`). Las secciones de Railway (§5.2) y n8n (§5.3) quedan como referencia para cuando haya
> presupuesto. El orden de trabajo vigente está en [`docs/guia_deploy.md`](docs/guia_deploy.md).

> Las acciones en paneles de proveedores (crear proyectos, cargar variables, aceptar términos y pagar planes) las hace el usuario. Claude prepara y verifica, pero no opera producción por MCP.

---

## 5.0 Entornos

| | Local | Staging (recomendado) | Producción |
|---|---|---|---|
| Supabase | `npx supabase start` | Proyecto `travelopt-staging` | Proyecto `travelopt-prod`, región **East US (N. Virginia)** |
| Motor | `uvicorn` en el puerto 8000 (`ENV=local`) | Railway, `ENV=staging` (los endpoints `/v1/dev/*` quedan activos) | Railway, `ENV=production` (`/v1/dev/*` responde 404) |
| n8n | Docker local | Instancia de staging | Instancia de prod |
| Vercel | `npm run dev` | Deployments **Preview** | Deployment **Production** |
| Datos | fixture | fixture o hybrid | fixture o hybrid hasta tener adapters live (ADR de la Fase 1) |

> Si no hay presupuesto para staging, los Preview pueden apuntar a prod con **Deployment Protection** activa, para que solo el equipo los vea. Igual se recomienda staging: es la red de seguridad de las migraciones.

## 5.1 Supabase en producción

1. Crear el proyecto en el panel: región **East US (North Virginia)**, contraseña de base fuerte guardada en un gestor.
2. Vincular la CLI y aplicar las migraciones. **Primero en staging, después en prod.**

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <REF_PROD>
```

```bash
npx supabase db push --dry-run
```

Revisar que la salida liste solo las migraciones esperadas. Después aplicar:

```bash
npx supabase db push
```

3. **Auth.**
   - *Authentication → Sign In / Providers*: habilitar **Allow anonymous sign-ins**.
   - *Attack Protection*: habilitar **CAPTCHA** (Cloudflare Turnstile). En producción, las sesiones anónimas sin CAPTCHA permiten crear usuarios en masa.
   - *URL Configuration*: Site URL = `https://<tu-dominio>`.
   - Revisar los rate limits de sign-in anónimo.

   **Ya integrado en el código:** `ensureSession` (`web/lib/supabase/client.ts`) pide el token a `web/lib/turnstile.ts` (widget
   invisible, solo aparece si Cloudflare exige interacción). En local se usan las claves de **prueba** públicas de Cloudflare
   (`supabase/config.toml` y la site key de desarrollo). En Cloudflare → Turnstile, crear el widget en modo **Managed** o
   **Invisible** con el dominio de producción.

   La site key de Turnstile es pública (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`). La secret de Turnstile se carga **solo en el panel de Supabase**, nunca en Vercel.

4. **Advisors** (*Advisors → Security / Performance*): 0 errores. RLS habilitada en las 6 tablas.
5. **Conexión del motor:** *Connect → Session pooler* (IPv4). Esa cadena, con `sslmode=require`, es el `DATABASE_URL` del motor.
6. **Claves:** la *publishable key* va a Vercel. La *secret key* **no se usa**: no copiarla a ningún lado.
7. **Backups:** confirmar los backups diarios del plan. PITR opcional (plan Pro).
8. **Staging por MCP** (solo lectura): registrar `supabase-staging` en scope local (Fase 0, §0.6.3).

## 5.2 Motor en Railway (Docker)

**`engine/Dockerfile`**

```dockerfile
# Extracto: el archivo real fija versiones exactas y las actualiza Dependabot.
FROM python:3.12.15-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /bin/

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
COPY fixtures ./fixtures
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH" ENV=production
RUN useradd --create-home appuser
USER appuser
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.api.main:app --host ${HOST:-0.0.0.0} --port ${PORT:-8000} --proxy-headers"]
```

1. *New Project → Deploy from GitHub repo* → servicio `engine`, **Root Directory** `engine`. Railway detecta el Dockerfile.
2. Región **US East**. **1 réplica**: el rate limiter es en proceso; para escalar horizontalmente hay que pasarlo a Redis (backlog).
3. Variables (*Variables*; ninguna en el repo):

| Variable | Valor |
|---|---|
| `ENV` | `production` (o `staging`) |
| `ENGINE_API_KEY` | **Nueva**: no reutilizar la local |
| `DATABASE_URL` | Session pooler de Supabase prod, con `sslmode=require` |
| `DEFAULT_MODE` | `fixture` o `hybrid` |
| `N8N_WEBHOOK_URL` | `https://<n8n-prod>/webhook/plan-trip` |
| `N8N_WEBHOOK_SECRET` | **Nuevo** |
| `OPENWEATHER_API_KEY` | Opcional; con tope diario configurado en el panel de OpenWeather |
| `STALE_RUN_SECONDS` | `600` |

4. Healthcheck path: `/healthz`. Generar un dominio público → es el `ENGINE_BASE_URL`.
5. `uv.lock` commiteado e imágenes con versión fija: hecho (verificado en local el 2026-10-28).

## 5.3 n8n en producción (self-hosted)

Servicio en Railway con la imagen `docker.n8n.io/n8nio/n8n:<versión fija>`, un Postgres propio de n8n (separado de Supabase) y un volumen en `/home/node/.n8n`.

| Variable | Valor |
|---|---|
| `N8N_ENCRYPTION_KEY` | **Nueva**, con copia offline |
| `DB_TYPE` | `postgresdb` |
| `DB_POSTGRESDB_HOST` / `PORT` / `DATABASE` / `USER` / `PASSWORD` | Referencias al Postgres del proyecto |
| `N8N_HOST` / `N8N_PROTOCOL` / `WEBHOOK_URL` | `<dominio>` / `https` / `https://<dominio>/` |
| `N8N_PROXY_HOPS` | `1` (detrás del proxy de Railway) |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `true` (los workflows no leen `$env`: la URL del motor es un literal dentro del workflow) |
| `GENERIC_TIMEZONE` | La del equipo |
| `N8N_DIAGNOSTICS_ENABLED` / `EXECUTIONS_DATA_PRUNE` / `EXECUTIONS_DATA_MAX_AGE` | `false` / `true` / `168` |
| `EXECUTIONS_DATA_SAVE_ON_SUCCESS` | `none` (no guardar los datos de las ejecuciones exitosas; las fallidas sí quedan para depurar) |
| `N8N_CONCURRENCY_PRODUCTION_LIMIT` / `EXECUTIONS_TIMEOUT` / `EXECUTIONS_TIMEOUT_MAX` / `N8N_PAYLOAD_SIZE_MAX` | `20` / `600` / `900` / `2` (los mismos topes que en `docker-compose.yml`) |

Pasos:
1. Crear la cuenta owner con contraseña fuerte y **2FA**.
2. Crear las credenciales `Webhook secret` y `Engine API key` con los valores **de producción**.
3. Generar los workflows de producción (la URL del motor queda en un solo lugar y el script exige https):

```bash
uv run --project engine python scripts/n8n_render.py --engine-url https://<motor-prod>
```

   Importar los 3 JSON de `n8n/dist/` (no los de `n8n/workflows/`, que apuntan a local). Después reasignar credenciales, asignar el error workflow y publicar o activar WF-01 y WF-03.
4. **No** crear una API key pública de n8n en prod (el devtools no se usa contra prod).

> **n8n Cloud:** no permite variables de entorno propias. Como la URL del motor ya es un literal en WF-01 y WF-03, no hace falta `$env` ni `$vars`: se importan los JSON generados en el paso 3. La variable `EXECUTIONS_DATA_SAVE_ON_SUCCESS` no existe ahí: se configura por workflow en *Settings → Save successful production executions = Do not save*.

## 5.4 Frontend en Vercel

> **Root Directory = `web`** en el proyecto de Vercel. La raíz del repo tiene otro `package.json` (CLI de Supabase) y Next avisa
> por dos lockfiles. No usar `turbopack.root`: en Windows con Next 16 duplica la ruta y escribe parte del build en `web/web/.next`.

1. *Add New → Project* → importar el repo → **Root Directory `web`**. Framework: Next.js (autodetectado).
2. *Settings → Functions → Region*: **Washington, D.C. (iad1)**, cerca de us-east-1.
3. *Settings → Environment Variables*, por entorno:

| Variable | Production | Preview | ¿Sensible? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL de prod | URL de staging | No (pública) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable de prod | Publishable de staging | No (pública, protegida por RLS) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Site key | Site key de test | No |
| `ENGINE_BASE_URL` | Motor de prod | Motor de staging | No |
| `ENGINE_API_KEY` | Clave de prod | Clave de staging | **Sí: marcar Sensitive** (no se puede volver a leer) |

4. *Deployment Protection*: activar la autenticación de Vercel para los **Preview**.
5. Dominio propio → actualizar *Site URL* en Supabase Auth.
6. Regla: **nunca** crear una variable `NEXT_PUBLIC_` con un secreto. Si pasa, rotar el secreto de inmediato.

## 5.5 CI/CD

**`.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  pull-requests: read

jobs:
  engine:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: engine } }
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --frozen
      - run: uv run ruff check .
      - run: uv run pytest -q

  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase db start
      - run: supabase test db

  web:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: web } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ci-placeholder

  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- *Branch protection* en `main`: exigir los jobs `engine`, `database`, `web` y `secrets` en verde.
- Migraciones: **manuales y controladas** (`db push` primero a staging, después a prod). No se aplican desde CI en el MVP.
- Vercel despliega automáticamente: un Preview por PR y Production al hacer merge en `main`. Railway redespliega el motor al hacer push.

## 5.6 Secretos: checklist y rotación

- [ ] Ningún secreto en git (`gitleaks` en verde; `git log -p | grep sb_secret_` vacío).
- [ ] Los valores de prod son **distintos** de los locales y de staging.
- [ ] `ENGINE_API_KEY` marcada Sensitive en Vercel y cargada solo en Vercel, Railway (motor) y la credencial de n8n.
- [ ] `N8N_ENCRYPTION_KEY` con copia offline.
- [ ] La contraseña de Postgres solo en `DATABASE_URL` del motor.
- [ ] Rotación de `ENGINE_API_KEY`: 1) generar una nueva; 2) cargarla en el motor; 3) actualizar la credencial de n8n y la variable de Vercel; 4) redesplegar. Hay unos segundos de 401: hacerlo fuera de horario.
- [ ] Rotación de `N8N_WEBHOOK_SECRET`: el mismo orden, con la credencial `Webhook secret`.

## 5.7 Smoke tests post-deploy

```bash
curl -s https://<motor-prod>/healthz
```

Debe responder `"env":"production"`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<motor-prod>/v1/dev/runs/orlando_nyc_5pax
```

Debe responder **404**: en producción los endpoints de desarrollo no existen.

En **staging**, el E2E completo con el devtools, apuntándolo explícitamente al host remoto. Desde una terminal con estas variables definidas solo para esa sesión: `DEVTOOLS_ALLOW_REMOTE=1`, `ENGINE_BASE_URL=https://<motor-staging>`, `ENGINE_API_KEY=<clave de staging>`. Luego pedir a Claude `e2e_via_n8n()` → `verdict: OK`.

## 5.8 Rollback

| Componente | Cómo |
|---|---|
| Frontend | Vercel → *Deployments* → deployment anterior → **Instant Rollback** |
| Motor | Railway → *Deployments* → redeploy del anterior |
| n8n | Reimportar el JSON del commit anterior y publicarlo |
| Base | Las migraciones van solo hacia adelante: se escribe una migración inversa. Ante pérdida de datos, PITR o backup |

## 5.9 Observabilidad mínima

Costo y salud por proveedor (SQL editor de Supabase o `supabase-staging` por MCP):

```sql
select provider, date_trunc('day', called_at) as dia, count(*) as llamadas,
       count(*) filter (where status_code >= 400 or status_code is null) as errores,
       percentile_cont(0.95) within group (order by latency_ms) as p95_ms
from public.api_usage
group by 1, 2
order by 2 desc, 1;
```

Además: monitor de uptime sobre `/healthz`, ejecuciones con error en n8n (WF-02 → email o Slack) y logs de Railway y Vercel.

---

## Checkpoints de validación (todos deben dar OK)

**Estado previo:** los checks con cuentas y paneles siguen pendientes. Verificado en local (2026-10-28): imagen del motor (CP-5.6 y CP-5.7: sin `DATABASE_URL` no arranca; con la base local, `/healthz` → `{"ok": true}`, `/docs` 404, rutas dev 404 con key, proceso como `appuser`) y `GATE FASE 5: OK`. El CI se actualizó (actions fijadas por SHA, Node 24, uv 0.13.5, Supabase CLI 2.122.0, `npm audit`) pero recién corre al subir el repo a GitHub.

| ID | Check | Cómo | OK si… |
|---|---|---|---|
| CP-5.1 | Migraciones en staging | `npx supabase db push` con staging vinculado | Sin errores; las mismas 6 tablas que en local |
| CP-5.2 | RLS en staging | `npx supabase test db --linked` (si la versión de la CLI lo soporta; si no, correr el SQL de pgTAP en el editor) | 8/8 OK. El test hace rollback y no deja datos |
| CP-5.3 | Migraciones en prod | `npx supabase db push --dry-run` y luego `npx supabase db push` | El dry-run lista solo lo esperado; el push sin errores |
| CP-5.4 | Advisors en prod | Panel → Advisors | 0 errores de seguridad |
| CP-5.5 | Auth en prod | Panel | Sesiones anónimas ON, CAPTCHA ON, Site URL correcta |
| CP-5.6 | Imagen del motor | Build en Railway (o `docker build engine` local) | Build OK; `/healthz` → `{"ok": true}` (sin detalles fuera de local); `/docs` y `/openapi.json` → 404 |
| CP-5.7 | Dev cerrado en prod | `POST /v1/dev/runs/...` | 404 |
| CP-5.8 | n8n prod | UI | WF-01 y WF-03 activos, WF-02 asignado, 2FA activo, sin API key pública |
| CP-5.9 | E2E staging | `e2e_via_n8n()` contra staging | `verdict: OK` |
| CP-5.10 | Smoke en prod | Correr el caso desde la UI de producción | `done`, **USD 20,083.62** en modo fixture |
| CP-5.11 | Secretos en el navegador | DevTools de prod → *Sources* → buscar `sb_secret_` y los primeros 8 caracteres de `ENGINE_API_KEY` | 0 resultados |
| CP-5.12 | CI | GitHub → Actions | `engine`, `database`, `web` y `secrets` en verde en `main` |
| CP-5.13 | Rollback | Instant Rollback en Vercel y volver | La app sigue funcionando en ambos sentidos |
| CP-5.14 | Checklist de secretos | §5.6 | Todos tildados |
| CP-5.15 | Gate | `uv run python scripts/gate.py 5` | `GATE FASE 5: OK` |
| CP-5.16 | Seguridad pre-deploy | [`docs/seguridad_predeploy.md`](docs/seguridad_predeploy.md) | Todos los ítems **P0** tildados antes de publicar el dominio; los **P1** dentro de la primera semana |

> **No se publica el dominio sin CP-5.16 (P0) completo.**
>
> Al cerrar: actualizar la tabla *Estado* de `master_plan.md`, hacer un commit `fase-5: gate OK` y un tag `v0.1.0`.
