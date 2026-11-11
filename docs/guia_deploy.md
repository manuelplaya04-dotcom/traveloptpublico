# Guía de deploy: quién hace qué y en qué orden

Ruta práctica para publicar TravelOpt. El detalle técnico de cada servicio está en [`fase_5_deploy.md`](../fase_5_deploy.md)
y los requisitos de seguridad en [`seguridad_predeploy.md`](seguridad_predeploy.md) (CP-5.16).

**Quién:** **Vos** = cuentas, contraseñas, pagos y paneles · **Claude** = código, scripts y verificación ·
**Juntos** = vos ejecutás en tu terminal o panel, Claude te guía y revisa el resultado.

**Reglas que valen para todas las etapas**
- Ninguna clave pasa por el chat: se genera en tu PC, se guarda en el gestor de contraseñas y se pega directo en el panel que la usa.
- Claves de producción **nuevas**; nunca reutilizar las locales.
- 2FA en cada cuenta **el mismo día** que se crea, con los códigos de respaldo en el gestor.

Para generar una clave aleatoria (en tu terminal):

```bash
uv run python -c "import secrets; print(secrets.token_urlsafe(32))"
```

---

## Etapa 0: identidad y cuentas base

| # | Paso | Quién |
|---|---|---|
| 0.1 | Gestor de contraseñas de Google + app autenticadora (Google o Microsoft Authenticator) con copia en la nube | Vos |
| 0.2 | Gmail nuevo del proyecto (solo para administrar cuentas) con 2FA | Vos |
| 0.3 | Cuenta de GitHub con ese Gmail, 2FA, y anotar el email *noreply* (Settings → Emails) | Vos |

## Etapa 1: repositorio

| # | Paso | Quién |
|---|---|---|
| 1.1 | Autor de git a tu nombre: configuración **solo de este repo** y reescritura de los commits locales (nunca se subieron). Necesita: nombre y email de autor | Claude |
| 1.2 | Crear un repo **privado y vacío** (sin README ni licencia) | Vos |
| 1.3 | Iniciar sesión en tu terminal (`gh auth login`), agregar el remoto y hacer el primer push | Juntos |
| 1.4 | *Settings → Rules*: ruleset de `main` sin borrado ni force-push (el CI obligatorio se suma al pasar a pull requests) | Vos |
| 1.5 | *Settings → Code security*: Dependabot alerts, Dependabot security updates y secret scanning en ON | Vos |
| 1.6 | Confirmar que el primer CI corre en verde (`engine`, `database`, `web`, `secrets`) | Juntos |

## Etapa 2: Cloudflare (CAPTCHA y, más adelante, dominio)

| # | Paso | Quién |
|---|---|---|
| 2.1 | Cuenta de Cloudflare con 2FA | Vos |
| 2.2 | *Turnstile → Add widget*: modo **Managed**, hostname `localhost` por ahora (el dominio se suma en la etapa 6). Guardar **site key** y **secret key** en el gestor | Vos |

## Etapa 3: Supabase producción

| # | Paso | Quién |
|---|---|---|
| 3.1 | Proyecto nuevo (región East US), contraseña de base generada y guardada. 2FA en la cuenta | Vos |
| 3.2 | `npx supabase login` + `link` + `db push --dry-run` y luego `db push` | Juntos |
| 3.3 | Auth: sesiones anónimas ON; *Bot and Abuse Protection* → Turnstile con la **secret key** de 2.2 | Vos |
| 3.4 | *Advisors → Security*: 0 errores (CP-5.4) | Juntos |
| 3.5 | Plan Free: no cobra (frena al llegar al límite). Pausa la base tras 7 días sin actividad: lo evita el reaper del motor (etapa 4) | — |

## Etapa 4: motor en Render (plan gratuito)

Decisión del 2026-11-01: **costo cero**. En producción el motor orquesta en proceso (`ORCHESTRATOR=inprocess`, sin n8n).
El plan Free se duerme tras 15 min sin uso; la web lo despierta (`/api/warmup`) y avisa si el arranque tarda.
Medido con los límites del plan (0,1 CPU, 512 MB): arranque en frío ~40 s, caso golden en 5 s, 92 MB de memoria.

| # | Paso | Quién |
|---|---|---|
| 4.1 | Cuenta en Render con el Gmail del proyecto (sin tarjeta), 2FA, y GitHub conectado **solo** al repo `travelopt` | Vos |
| 4.2 | *New → Blueprint* → repo `travelopt` (lee `render.yaml`). Pegar `DATABASE_URL` (Supabase → Connect → Session pooler + `?sslmode=require`). `ENGINE_API_KEY` la genera Render: copiarla al gestor | Vos |
| 4.3 | Con el deploy en verde: verificar `/healthz` → `{"ok": true}`, `/docs` y rutas dev → 404 (CP-5.6/5.7) | Claude |
| 4.4 | Crear una corrida contra producción y verificar el golden (CP-5.10, parte motor) | Juntos |

## Etapa 5: monitor y "despertador" (UptimeRobot)

| # | Paso | Quién |
|---|---|---|
| 5.1 | Cuenta gratuita en UptimeRobot con el Gmail del proyecto y 2FA | Vos |
| 5.2 | Monitor HTTP cada 5 min a `https://<motor>.onrender.com/healthz`, con aviso por email | Vos |
| 5.3 | Efecto: el motor no se duerme (750 h/mes del plan alcanzan para uno siempre prendido) y su reaper mantiene activa la base de Supabase | — |

n8n en producción queda **fuera** mientras no haya presupuesto. Sigue en local para desarrollo; para volver a usarlo:
`ORCHESTRATOR=n8n` + §5.3 de `fase_5_deploy.md` (`scripts/n8n_render.py`).

## Etapa 6: web en Vercel (plan Hobby)

| # | Paso | Quién |
|---|---|---|
| 6.1 | Cuenta con el Gmail del proyecto y 2FA; proyecto desde el repo con **Root Directory `web`** | Vos |
| 6.2 | Variables (§5.4): Supabase URL y publishable key, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `ENGINE_BASE_URL` (la URL de Render), `ENGINE_API_KEY` (**Sensitive**, la misma de Render) | Vos |
| 6.3 | Dominio: **opcional**. Sin dominio se usa `travelopt.vercel.app` | — |
| 6.4 | Sumar el hostname de Vercel al widget de Turnstile y ponerlo como *Site URL* en Supabase Auth | Vos |
| 6.5 | Protección de los *Preview* | Vos |

Hobby es gratis pero para **uso no comercial**: si el proyecto empieza a cobrar, pasar a Pro.

## Etapa 7: verificación antes de anunciar

| # | Paso | Quién |
|---|---|---|
| 7.1 | Caso golden desde la UI de producción → `done`, **USD 20,083.62** (CP-5.10) | Juntos |
| 7.2 | Buscar secretos en el bundle de producción (CP-5.11) | Juntos |
| 7.3 | Probar el rollback de Vercel (CP-5.13) | Vos |
| 7.4 | Repasar `seguridad_predeploy.md`: **todos los P0 tildados** | Juntos |

## Etapa 8: legal (antes de anunciar el sitio)

| # | Paso | Quién |
|---|---|---|
| 8.1 | ✅ Sin datos personales publicados: herramienta gratuita y demostrativa, búsquedas que se borran a los 30 días. Si pasa a ser comercial: responsable y email del proyecto en `web/lib/legal.ts` | Claude |
| 8.2 | Revisión del texto legal por un abogado | Vos |
| 8.3 | Licencia comercial de Open-Meteo, o apagar el "Ver más" del clima hasta tenerla | Vos (Claude lo apaga si hace falta) |

## Primera semana (P1)

Backups con prueba de restauración, monitor de disponibilidad, rate limit por IP en el firewall de Vercel para
`/api/trips` y `/api/weather`. Detalle en `seguridad_predeploy.md`.

---

## Estado (2026-11-01)

- **Etapa 0** ✅ Gmail del proyecto con 2FA; GitHub personal con 2FA; gestor de contraseñas de Google + app autenticadora.
- **Etapa 1** ✅ Repo privado `manuelplaya04-dotcom/travelopt` (autoría "Manu Playa", historial escaneado), CI en verde,
  ruleset de `main` (sin borrado ni force-push), Dependabot sin saltos mayores.
- **Etapa 2** ✅ Cloudflare con 2FA y widget Turnstile (Managed; hostnames `localhost` y `travelopt-rho.vercel.app`).
- **Etapa 3** ✅ Supabase `travelopt-prod` (us-east-1) con 2FA, sesiones anónimas y CAPTCHA activos. Las 3 migraciones
  aplicadas y verificadas (RLS en las 6 tablas, el navegador solo lee lo suyo, `rls_auto_enable()` sin EXECUTE para
  anon/authenticated, índices en las claves foráneas). Security Advisor: 0 errores.
  - Pendiente menor: alerta de gasto (en el plan Free no hay cobros; revisar al pasar a Pro).
  - Advisors aceptados: "Anonymous Access Policies" (diseño: cada sesión anónima lee solo sus filas) y "RLS sin
    políticas" en `api_cache`/`api_usage` (solo backend).
- **Etapa 4** ✅ Motor en Render Free (`https://travelopt-engine.onrender.com`) vía Blueprint, con 2FA. `/healthz` sin
  detalles, docs/openapi 404, sin clave 401. Solo se reconstruye si cambia `engine/`.
- **Etapa 5** ✅ UptimeRobot cada 5 min a `/healthz` (el motor no se duerme y la base no se pausa).
- **Etapa 6** ✅ Web en Vercel Hobby: `https://travelopt-rho.vercel.app`. Site URL de Supabase y hostname de Turnstile
  actualizados. Cabeceras de seguridad verificadas; APIs rechazan otros orígenes y pedidos sin sesión.
- **Etapa 7** ◐ 7.1 ✅ caso golden desde la UI de producción (`done`, USD 20,083.62, con CAPTCHA real) · 7.2 ✅ sin
  secretos en el bundle publicado (solo el texto de supabase-js que detecta prefijos) · 7.3 ☐ rollback · 7.4 ☐ repaso P0.
  - Bug encontrado y corregido en producción: el desafío de Turnstile quedaba fuera del `<dialog>` modal (inerte).
- **Siguiente:** 7.3 (probar rollback en Vercel), Etapa 8 (legal: responsable y email de contacto) y 2FA pendientes.
