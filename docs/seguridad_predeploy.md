# Checklist de seguridad antes de publicar TravelOpt

**Regla:** la Fase 5 no se cierra (ni se publica el dominio) hasta que todos los ítems **P0** estén tildados.
Los **P1** se completan en la primera semana. Este archivo es parte del gate manual de la Fase 5 (CP-5.16).

Contexto: TravelOpt no maneja pagos, contraseñas ni datos personales. El riesgo real está en las **cuentas y claves
del equipo**, el **abuso que genera costos**, el **panel de n8n** y lo **legal**.

Leyenda: ✅ ya resuelto en el código · ☐ pendiente (acción en paneles o de terceros)

---

## P0: obligatorio antes de publicar

### 1. Cuentas y claves (el riesgo más grave)
- ✅ 2FA en el **email** del proyecto (es la llave de todas las demás cuentas).
- ◐ 2FA en cada cuenta: ✅ GitHub, Cloudflare, Supabase, Render · ☐ confirmar Vercel y UptimeRobot (y el registrador, si se compra dominio).
- ☐ Claves **nuevas solo para producción**, distintas de las locales: `ENGINE_API_KEY` (la genera Render), password de la base (✅ generada).
- ✅ Claves guardadas en un **gestor de contraseñas** (Google); nunca en chats, mails ni capturas.
- ✅ Ninguna clave en el código ni en el historial de git (escaneo hecho el 2026-10-28).
- ✅ CI con `gitleaks` en cada push.
- ✅ El navegador solo recibe la publishable key de Supabase; `ENGINE_API_KEY` vive en el servidor (`server-only`) y el gate verifica que no esté en el bundle.

### 2. Repositorio
- ✅ Repo de GitHub **privado** (`manuelplaya04-dotcom/travelopt`), autoría a nombre del dueño, historial escaneado con gitleaks antes del primer push.
- ✅ Ruleset de `main`: sin borrado ni force-push. (CI obligatorio: al pasar a pull requests.)

### 3. Abuso y costos
- ✅ CAPTCHA (Cloudflare Turnstile) integrado en el alta anónima y probado en local con las claves de prueba.
- ✅ **CAPTCHA en producción:** widget en Cloudflare, secret en Supabase y site key en Vercel; probado con una búsqueda real (2026-11-01).
- ✅ Costo cero por diseño: Render Free, Vercel Hobby y Supabase Free no cobran (frenan o duermen al llegar al límite).
- ✅ Rate limit por usuario (2 corridas activas, 10 por hora) y tope global (20 activas), atómico en Postgres.
- ✅ Tope de combinaciones en el pedido de viaje (el motor rechaza búsquedas gigantes).
- ✅ Clima de detalle: solo ciudades del catálogo y caché (no es un proxy abierto a Open-Meteo); 30 consultas por usuario y hora.
- ✅ n8n (local) con topes: 20 ejecuciones concurrentes, timeout de 600 s, payload máximo de 2 MiB.
- ✅ Producción (orquestación en proceso): como mucho 2 optimizaciones simultáneas y reaper cada 5 min.

### 4. Base de datos (Supabase producción)
- ✅ **Security Advisor = 0 errores** (CP-5.4, 2026-11-01). Quedan avisos aceptados por diseño: políticas para sesiones
  anónimas (cada una lee solo lo suyo) y `api_cache`/`api_usage` sin políticas (solo backend).
- ✅ `DATABASE_URL` solo en Render (motor), nunca en Vercel ni con `NEXT_PUBLIC_`. La secret key (`sb_secret_…`) no se usa.
- ✅ RLS: cada usuario ve solo sus corridas, itinerarios y ofertas (pgTAP 10/10 + E2E entre usuarios).
- ✅ El navegador no puede escribir en ninguna tabla.
- ✅ `search_runs.error` guarda solo código y nodo; el detalle interno queda en el log del motor.

### 5. n8n
> **No aplica en producción mientras `ORCHESTRATOR=inprocess`** (decisión del 2026-11-01). Si se vuelve a usar n8n
> en producción, estos ítems pasan a ser P0.

- ☐ Contraseña fuerte + **2FA** en la cuenta owner.
- ☐ **Panel no público:** acceso restringido por IP, VPN o Cloudflare Access; solo el webhook queda expuesto.
- ☐ Sin API key pública; versión actualizada.
- ✅ Webhook protegido con secreto; nodos sin acceso a variables de entorno.
- ✅ URL del motor fija en el workflow y `run_id` validado como UUID antes de armar la URL (sin SSRF desde el body).
- ☐ En producción: workflows generados con `scripts/n8n_render.py` y la URL https del motor.

### 6. Motor (Render)
- ✅ Sin `/docs` ni `/openapi.json` públicos; `/healthz` sin detalles; rutas de desarrollo cerradas (verificado con la imagen).
- ✅ No arranca sin `DATABASE_URL` en producción; corre como usuario sin privilegios.
- ✅ Anti-SSRF: lista blanca de hosts de salida (https, puerto 443, sin credenciales) y sin seguir redirecciones.
- ✅ Body estricto en `/v1/runs` (campos desconocidos = 422) y `user_id` tomado de la sesión, nunca del navegador.
- ✅ `ENV=production` y `ORCHESTRATOR=inprocess` fijos en `render.yaml`.
- ✅ Verificado con los límites del plan Free (0,1 CPU, 512 MB): arranque ~40 s, golden en 5 s, 92 MB.

### 7. Legal
- ✅ Sin datos personales del responsable publicados (decisión 2026-11-01): herramienta gratuita, sin fines comerciales y
  demostrativa; las búsquedas se borran solas a los 30 días. Si pasa a ser comercial: completar `web/lib/legal.ts`.
- ☐ **Revisión del texto legal por un abogado** (obligatoria antes de cobrar o promocionar comercialmente).
- ✅ Open-Meteo: uso no comercial, compatible con la herramienta gratuita. ☐ Licencia comercial si el proyecto pasa a cobrar.
- ☐ Revisar los términos de uso de cada proveedor de datos que se conecte (vuelos, alojamiento, actividades).
- ✅ Página de Información legal publicada en el pie (sin garantías, no somos agencia, limitación de responsabilidad, privacidad).

---

## P1: primera semana

- ☐ **Backups** de la base (PITR en el plan pago de Supabase) y una prueba de restauración.
- ☐ **Monitor de disponibilidad** (por ejemplo, ping a la web y a `/healthz`) con aviso por email.
- ☐ Probar **rollback** en Vercel (CP-5.13).
- ✅ Configuración de Dependabot (`.github/dependabot.yml`: npm, uv, actions y Docker).
- ☐ **Dependabot** activado en GitHub (alertas y updates de seguridad).
- ☐ **Rate limit por IP** en el firewall de Vercel para `/api/trips` y `/api/weather`.
- ☐ Dominio con **bloqueo de transferencia** en el registrador.
- ✅ Dependencias auditadas en el CI (`npm audit`); actions fijadas por SHA; imagen del motor con versiones fijas.

## P2: después

- ☐ CSP con **nonce** (hoy `script-src` usa `'unsafe-inline'`, que exige el runtime de Next sin nonces).
- ☐ Revisión periódica de logs de Supabase, Render y Vercel.
- ☐ Registro de marca, si el proyecto avanza.

---

## Qué hacer si se filtra una clave

1. **Rotarla ya** en el panel del proveedor (Supabase, Render, Cloudflare) y actualizar la variable donde se usa.
2. Redeploy del servicio afectado.
3. Revisar los logs desde la fecha probable de la filtración.
4. Si la clave llegó a git: rotarla igual (borrar el commit **no** alcanza).

---

## Mapeo OWASP API Security Top 10 (2023)

Revisión del 2026-10-28. Cada control tiene un test que lo sostiene.

| Riesgo | Control | Dónde |
|---|---|---|
| API1 BOLA | RLS por `auth.uid()` en las 4 tablas legibles; el motor es el único escritor | `supabase/migrations/`, `supabase/tests/database/rls.test.sql` |
| API2 Autenticación | Clave de servicio entre Next, n8n y motor (comparación en tiempo constante); sesión de Supabase en Next | `engine/app/api/main.py`, `web/app/api/*` |
| API3 BOPLA | Sin escritura desde el navegador; body estricto (`extra="forbid"`); `error` sin detalle interno | `test_api_extraction.py` |
| API4 Consumo de recursos | Corridas: 2 activas / 10 por hora / 20 globales (Postgres atómico). Clima: 30/h por usuario. Body 64 KiB. n8n con concurrencia, timeout y payload acotados. PostgREST `max_rows=1000` | `test_rate_limit.py`, `test_weather_insights.py`, `docker-compose.yml` |
| API5 Autorización por función | Rutas dev y docs devuelven 404 fuera de local | `test_hardening.py` |
| API6 Flujos sensibles | CAPTCHA Turnstile en el alta anónima (faltan las claves de producción) | `web/lib/turnstile.ts`, `supabase/config.toml` |
| API7 SSRF | Lista blanca de salida en el cliente HTTP; coordenadas del clima resueltas en el servidor; URL del motor fija en n8n | `test_egress.py` |
| API8 Configuración | CSP y cabeceras de seguridad, HSTS, sin `X-Powered-By`, imagen sin root, CI con actions por SHA | `web/next.config.ts`, `engine/Dockerfile` |
| API9 Inventario | Sin OpenAPI público; rutas listadas en `master_plan.md` | `test_hardening.py` |
| API10 Consumo de APIs de terceros | Deeplinks solo https (modelo y `safeHref`); timeouts, reintentos acotados y token bucket por proveedor | `test_model_bounds.py`, `test_weather_and_http.py` |

XSS: React escapa todo el texto; no hay `dangerouslySetInnerHTML`; los `href` pasan por `safeHref` (solo https) y el
modelo canónico rechaza `javascript:`, `data:` y URLs con credenciales.
