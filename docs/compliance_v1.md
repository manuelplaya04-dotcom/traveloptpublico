# V1 · Factibilidad a costo cero y compliance (Ley 25.326, ISO/IEC 27001, ISO/IEC 25010)

**Alcance V1:** 7 ciudades de la costa este de EE.UU. (Nueva York, Brooklyn, Orlando, Miami, Filadelfia, Boston, Washington).
**Fecha:** 2026-11-02. **Naturaleza:** autoevaluación técnica de alineación. **No es una certificación ISO ni un
dictamen legal**: certificar ISO 27001 requiere un SGSI auditado por un organismo acreditado, y la adecuación a la
Ley 25.326 debe validarla un abogado (ya registrado como requisito antes de uso comercial, decisión 3).

---

## 1. Análisis de factibilidad (stack 100 % gratuito)

| Característica | Solución en producción sin costo | Riesgo / límite |
|---|---|---|
| Mapa y marcadores | Leaflet + tiles de OpenStreetMap vía `/api/tiles` (proxy con caché de CDN) | Política de uso de OSM: el proxy cachea para no cargar su servidor; con tráfico alto, mover a un proveedor con plan gratuito |
| Distancias alojamiento ↔ actividad | Haversine × 1,3 (factor de calles) en el navegador, sin red | Es una estimación; el ruteo real llega con OpenRouteService (clave gratuita, Fase 6.5) |
| Miniaturas | Placeholders de proporción fija (sin requests a terceros). Fotos reales: Wikimedia Commons vía Wikidata (licencias CC con atribución, Fase 6.3) | Bancos de imágenes "gratuitos" (Unsplash, Pexels) exigen API key, atribución y prohíben el hotlinking sin su API; además cada imagen externa filtra la IP del visitante a un tercero |
| Más datos de Nueva York y Orlando | Fuera del caso de prueba, alojamientos y actividades del fixture **más** los simulados | Datos simulados y rotulados como tales hasta conectar proveedores |
| Links a plataformas | Búsquedas reales en Expedia, Airbnb, Booking, Google, Skyscanner, Despegar (sin precios atribuidos) | Formatos de URL públicos que pueden cambiar; se validan con `safeHref` |
| Deportes (NBA, NHL, MLB, NFL, MLS) | Solo información estática real (equipo, liga, estadio) y botón "Ver calendario oficial y entradas" (búsqueda en Ticketmaster). **Sin fechas ni partidos simulados** | Para mostrar partidos con fecha hace falta una fuente real (feed oficial o API con plan gratuito); hasta entonces no se muestran |
| Momento óptimo de compra | Tipos definidos (`web/lib/buyTiming.ts`) y espacio en la UI; historial propio en Supabase a partir de las cotizaciones que el motor ya guarda | Requiere semanas de historial antes de dar una recomendación confiable |

## 2. Compliance

### 2.1 Ley 25.326 (Protección de Datos Personales, Argentina)

| Principio | Implementación | Estado |
|---|---|---|
| Privacidad por diseño / minimización (art. 4) | Sesión **anónima** de Supabase (sin nombre, email ni teléfono); el pedido de viaje no contiene datos identificatorios | ✅ |
| Persistencia en el navegador | Selecciones del carrito en `sessionStorage` (se borran al cerrar la pestaña) y solo con ids de ofertas, nunca precios ni datos personales | ✅ (cambio de esta versión: antes `localStorage`) |
| Token de sesión | Cookie de Supabase con un token anónimo, **solo de sesión** (sin Max-Age/Expires: desaparece al cerrar el navegador) y `Secure` en HTTPS | ✅ |
| Conservación limitada (art. 4 inc. 7) | Búsquedas, corridas, ofertas, registro de uso y errores del navegador se borran solos a los 30 días | ✅ |
| Seguridad (art. 9) | RLS por usuario, el navegador no escribe en la base, cifrado en tránsito (TLS) y en reposo (Supabase) | ✅ |
| Cesión a terceros (art. 11) | Ningún dato del usuario va a terceros: los mapas pasan por nuestro proxy; Turnstile (CAPTCHA) informado en la página legal | ✅ |
| Información al titular (art. 6) | Página `/legal` con finalidad, retención y responsable | ✅ (contacto pendiente para uso comercial) |

### 2.2 ISO/IEC 27001 (seguridad de la información, tríada CIA)

| Control (Anexo A) | Implementación | Estado |
|---|---|---|
| Confidencialidad: control de acceso (A.5.15, A.8.3) | RLS por `auth.uid()` con pgTAP; tablas internas sin políticas (`client_errors`) | ✅ |
| Confidencialidad: criptografía (A.8.24) | HTTPS en todo; HSTS 2 años; egress del motor solo `https` a una lista blanca | ✅ |
| Integridad: validación de entradas (A.8.28) | Pydantic `extra="forbid"` en el motor, zod en la web, nombres de ciudad con patrón de solo letras, links con `safeHref` | ✅ |
| Integridad: XSS | React escapa, CSP con nonce por pedido y `'strict-dynamic'` en `script-src` (sin `'unsafe-inline'`) | ✅ (`style-src` conserva `'unsafe-inline'`: estilos, no scripts) |
| Disponibilidad (A.8.14) | Circuit breaker, backoff, degradación elegante, UptimeRobot, límites por usuario | ✅ |
| Registro y monitoreo (A.8.15, A.8.16) | Logs del motor, errores del navegador en `client_errors` | ◐ Sin alertas automáticas (notificación del Error Trigger pendiente) |
| Gestión de secretos (A.8.12) | Secretos solo en paneles de los proveedores, gitleaks en el CI, sin secretos en el bundle (gate 5) | ✅ |

### 2.3 ISO/IEC 25010 (calidad del producto)

| Característica | Evidencia | Estado |
|---|---|---|
| Eficiencia de desempeño | CLS 0; mapa e impresión fuera de la carga inicial (`next/dynamic`, montaje al imprimir); tarjetas memoizadas; landing estática | ✅ |
| Mantenibilidad (modularidad, analizabilidad, testeabilidad) | Lógica en funciones puras (`web/lib/*`) con tests; proveedores intercambiables (Adapter); deportes en un módulo propio | ✅ |
| Fiabilidad | 470+ tests del motor, fuzz de combinaciones, Error Boundaries, cancelación de pedidos | ✅ |
| Usabilidad / accesibilidad | axe-core (WCAG 2.1 AA) en los E2E: 0 violaciones serias | ✅ |
| Seguridad | Ver 2.2 | ✅ (salvo alertas automáticas) |
| Portabilidad | Docker para el motor, despliegue declarativo (`render.yaml`) | ✅ |

## 3. Decisiones tomadas (2026-11-02)

1. **Chicago** fuera de la V1: alcance estrictamente costa este.
2. **Sesión anónima temporal:** cookie de sesión del navegador; sin CAPTCHA repetido mientras se arma el viaje.
3. **CSP con nonce:** implementada; se apagó el prerenderizado parcial (costo de rendimiento aceptado). Ver decisión 9 en `project_guidelines.md`.
4. **Datos simulados:** todo dato de prueba lleva el sello "Dato de ejemplo" en su tarjeta; deportes sin fechas.
