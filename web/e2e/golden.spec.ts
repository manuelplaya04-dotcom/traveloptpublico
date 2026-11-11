// Requiere motor (8000), n8n (5678) y Supabase local corriendo. Ver fase_4_frontend.md y fase_4b_frontend_ux.md.
import { expect, test, type Locator, type Page } from "@playwright/test";

// Consola limpia: cualquier error no capturado del navegador (p. ej. "_leaflet_pos") hace fallar el test.
const pageErrors = new Map<object, Error[]>();
test.beforeEach(({ page }) => {
  const errors: Error[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (e) => errors.push(e));
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)?.map((e) => e.message) ?? []).toEqual([]);
});

// Buscador de destinos: escribe y elige la primera sugerencia que empieza con ese nombre.
async function addCity(dialog: Locator, name: string) {
  await dialog.getByRole("combobox").fill(name);
  await dialog.getByRole("option", { name: new RegExp(`^${name}`) }).first().click();
}
const nightsOf = (dialog: Locator, city: string) => dialog.getByRole("spinbutton", { name: `Noches en ${city}` });

async function openForm(page: Page): Promise<Locator> {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Armemos tu viaje" });
  // El CTA queda deshabilitado hasta hidratar: Playwright espera a que esté habilitado antes de hacer clic.
  await page.getByRole("button", { name: "Armamos tu viaje" }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

// Caso golden cargado como lo haría una persona (no hay botón de ejemplo en producción).
async function goldenDestinations(dialog: Locator) {
  await addCity(dialog, "Orlando");
  await addCity(dialog, "Nueva York");
  await nightsOf(dialog, "Orlando").fill("8");
  await nightsOf(dialog, "Nueva York").fill("4");
  await expect(dialog.getByTestId("nights-allocation")).toHaveText("Noches asignadas: 12 de 12 ✓");
}
async function goldenDates(dialog: Locator) {
  await dialog.getByLabel("Fecha de ida (primera noche)").fill("2027-07-08");
  await dialog.getByLabel("Flexibilidad de ida (días)").fill("1");
  await dialog.getByLabel("Viajeros").fill("5");
  await dialog.getByLabel("Presupuesto total (USD)").fill("21000");
}

// Landing → "Armamos tu viaje" → caso golden → paso de preferencias.
async function openPreferences(page: Page) {
  const dialog = await openForm(page);
  await goldenDestinations(dialog);
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await goldenDates(dialog);
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  return dialog;
}

// Corre el caso golden y espera el resultado.
async function goldenRun(page: Page) {
  const dialog = await openPreferences(page);
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  // 30 s: en `next dev` la primera request compila /api/trips y /runs/[id].
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
}

test("caso Orlando + NYC llega al óptimo exacto", async ({ page }) => {
  await goldenRun(page);
  await expect(page.getByTestId("best-total")).toHaveText("USD 20,083.62");
  await expect(page.getByTestId("per-pax")).toHaveText(
    "USD 4,016.73 / USD 4,016.73 / USD 4,016.72 / USD 4,016.72 / USD 4,016.72");
  await expect(page.getByTestId("fixture-notice")).toBeVisible();
  await page.getByTestId("step-viaje").click();
  await expect(page.getByTestId("funnel")).toContainText("Alojamientos con menos baños que el mínimo");
});

test("3 baños mínimos cambia el óptimo y excede el presupuesto", async ({ page }) => {
  const dialog = await openPreferences(page);
  await dialog.getByLabel("Baños mínimos").fill("3");
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
  await expect(page.getByTestId("best-total")).toHaveText("USD 21,636.38");
  await expect(page.getByTestId("over-budget")).toContainText("USD 636.38");
});

test("sin escalas no hay solución factible", async ({ page }) => {
  const dialog = await openPreferences(page);
  await dialog.getByLabel("Escalas máximas").fill("0");
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("infeasible", { timeout: 60_000 });
  // sin datos de rescate: el motor explica qué flexibilizar según su embudo
  await expect(page.getByTestId("suggestions")).toContainText("Permití al menos 1 escala");
});

test("CP-4b.3: el modal se abre sin recargar, Esc lo cierra y el foco vuelve al CTA", async ({ page }) => {
  await page.goto("/");
  const cta = page.getByRole("button", { name: "Armamos tu viaje" });
  await cta.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL("/");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(cta).toBeFocused();
});

test("4b.2: hub de vuelos — pestañas por tramo y subtotal por la diferencia exacta", async ({ page }) => {
  await goldenRun(page);
  await expect(page.getByTestId("cart-total")).toHaveText("USD 20,083.62");
  await expect(page.getByTestId("cart-delta")).toHaveText("✓ Elección óptima");

  // Paso "Vuelos" y pestaña "Ida" por defecto. F01 (Copa, valija incluida): 5 × 980 = 4,900.00 vs. 4,650.00.
  await expect(page.getByRole("tab", { name: /Ida/ })).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("flight-F01").getByRole("button", { name: "Seleccionar" }).click();
  await expect(page.getByTestId("cart-total")).toHaveText("USD 20,333.62");
  await expect(page.getByTestId("cart-delta")).toHaveText("+USD 250.00 vs. óptimo");
  await expect(page.getByRole("tab", { name: /Ida/ })).toContainText("USD 4,900.00");

  await page.getByRole("tab", { name: /Interconexión/ }).click();
  await expect(page.getByTestId("flight-F01")).toHaveCount(0);
  await page.getByText("Ver 1 descartada y por qué").click();
  await expect(page.getByTestId("flight-F14")).toContainText("Sale antes de tu hora mínima");

  await page.getByRole("tab", { name: /Todos/ }).click();
  expect(await page.locator("[data-testid^=flight-F]").count()).toBeGreaterThanOrEqual(5);

  await page.getByRole("button", { name: "Volver al óptimo" }).click();
  await expect(page.getByTestId("cart-total")).toHaveText("USD 20,083.62");
});

test("4b.3: dashboard por ciudad — alojamiento seleccionable, clima, movilidad y actividades", async ({ page }) => {
  await goldenRun(page);
  await page.getByTestId("step-ORL").click();
  const orl = page.locator("#city-ORL");
  await expect(orl.getByRole("heading", { name: "Orlando", exact: true })).toBeVisible();
  await expect(orl.getByTestId("mobility-total")).toHaveText("USD 772.00");
  await expect(orl.getByText("Epic Universe (1 día)").last()).toBeVisible();
  await orl.getByText("Ver 1 descartada y por qué").click();
  await expect(orl.getByTestId("lodging-H3")).toContainText("Menos baños que tu mínimo");
  // El botón de selección (la tarjeta también tiene "Ver en mapa", que no selecciona)
  await expect(orl.getByTestId("lodging-H2").getByRole("button", { name: /Seleccion/ })).toHaveText("✓ Seleccionado");

  // H1: 2,644.55 vs. 1,867.50 de H2 (impuestos y limpieza incluidos) → +777.05
  await orl.getByTestId("lodging-H1").getByRole("button", { name: "Seleccionar" }).click();
  await expect(page.getByTestId("cart-total")).toHaveText("USD 20,860.67");
  await expect(page.getByTestId("cart-delta")).toHaveText("+USD 777.05 vs. óptimo");

  await page.getByRole("button", { name: /Siguiente: Nueva York/ }).click();
  const nyc = page.locator("#city-NYC");
  await nyc.getByText("Ver 1 descartada y por qué").click();
  await expect(nyc.getByTestId("lodging-N3")).toContainText("Alquiler temporario no legal");
});

test("4b.3: reordenar ciudades lanza una corrida nueva con ese orden", async ({ page }) => {
  await goldenRun(page);
  const first = page.url();
  await page.getByRole("button", { name: "Mover Nueva York antes" }).click();
  await expect(page.getByTestId("order-NYC")).toContainText("1. Nueva York");
  await page.getByRole("button", { name: "Recalcular con este orden" }).click();
  await expect(page).not.toHaveURL(first, { timeout: 30_000 });
  // Next conserva oculta la corrida anterior (<Activity>): se mira solo la visible.
  const status = page.locator("[data-testid=run-status]:visible");
  await expect(status).toHaveText(/done|infeasible/, { timeout: 60_000 });
});

test("4b.4: checkout — rubros, calendario, confirmación y elecciones que sobreviven a recargar", async ({ page }) => {
  await goldenRun(page);
  await page.getByTestId("step-viaje").click();
  const checkout = page.locator("#checkout");
  await expect(checkout.getByTestId("rubro-vuelos")).toHaveText("USD 9,600.00"); // ida 4,650 + vuelta 4,950
  await expect(checkout.getByTestId("rubro-interconexiones")).toHaveText("USD 885.00");
  await expect(checkout.getByTestId("checkout-total")).toHaveText("USD 20,083.62");
  const timeline = checkout.getByTestId("timeline");
  await expect(timeline.locator("li", { hasText: "mar, 20 jul" })).toContainText("Noche en vuelo");
  await expect(timeline.locator("li", { hasText: "mié, 21 jul" })).toContainText("De vuelta en casa");
  await expect(timeline.locator("li", { hasText: "vie, 9 jul" })).toContainText("Epic Universe");
  // Día 1 (sin índice 0), agrupado por destino con noches y señales de los horarios de vuelo del golden:
  // F02 llega a MCO 21:40 (día de traslado), F13 llega a LGA 11:45 (drop-off), F21 sale 18:00 (no es "aprovechable").
  await expect(timeline.locator("li", { hasText: "jue, 8 jul" })).toContainText("Día 1");
  await expect(timeline.locator("li", { hasText: "jue, 8 jul" }).getByTestId("day-tag-transfer")).toBeVisible();
  await expect(timeline.getByTestId("timeline-group-ORL").getByTestId("stay-summary")).toHaveText(/Check-in: jue, 8 jul · Check-out: vie, 16 jul \(8 noches\)/);
  await expect(timeline.getByTestId("timeline-group-NYC").getByTestId("stay-summary")).toContainText("(4 noches)");
  await expect(timeline.locator("li", { hasText: "vie, 16 jul" }).getByTestId("day-tag-drop_off")).toContainText("11:45");
  await expect(timeline.getByTestId("day-tag-last_usable")).toHaveCount(0);

  await checkout.getByRole("button", { name: "Confirmar itinerario" }).click();
  await expect(checkout.getByTestId("purchase-links")).toContainText("Entradas · Epic Universe (1 día)");

  // Cambiar alojamiento: el calendario y el total lo reflejan, y la elección persiste al recargar.
  await page.getByTestId("step-ORL").click();
  await page.locator("#city-ORL").getByTestId("lodging-H1").getByRole("button", { name: "Seleccionar" }).click();
  await page.getByTestId("step-viaje").click();
  await expect(page.getByTestId("checkout-total")).toHaveText("USD 20,860.67");
  await expect(page.getByTestId("timeline").locator("li", { hasText: "vie, 9 jul" })).toContainText("Villa 4 dorm. Kissimmee");
  await page.reload();
  await expect(page.getByTestId("cart-total")).toHaveText("USD 20,860.67", { timeout: 30_000 });
});

test("catálogo de actividades: elegir qué hacer y re-optimizar el calendario", async ({ page }) => {
  await goldenRun(page);
  await page.getByTestId("step-ORL").click();
  const catalog = page.getByTestId("catalog-ORL");
  await expect(catalog.getByRole("checkbox")).toHaveCount(8); // 5 imperdibles + 3 opcionales
  await expect(catalog.getByRole("checkbox", { name: "Epic Universe (1 día)" })).toBeChecked();
  const first = page.url();
  await catalog.getByRole("checkbox", { name: "Medieval Times (cena show)" }).check();
  await catalog.getByRole("button", { name: "Optimizar calendario (6)" }).click();
  await expect(page).not.toHaveURL(first, { timeout: 30_000 });
  const status = page.locator("[data-testid=run-status]:visible");
  await expect(status).toHaveText("done", { timeout: 60_000 });
  await page.locator("[data-testid=step-ORL]:visible").click();
  await expect(page.locator("#city-ORL:visible").getByText("Medieval Times (cena show)").last()).toBeVisible();
});

test("clima: 'Ver más' trae históricos año por año y el pronóstico (Open-Meteo vía motor)", async ({ page }) => {
  await goldenRun(page);
  await page.getByTestId("step-ORL").click();
  const orl = page.locator("#city-ORL");
  await expect(orl.getByText("Datos de ejemplo (modo de prueba)")).toBeVisible();
  await orl.getByRole("button", { name: "Ver más: históricos y pronóstico" }).click();
  const detail = orl.getByTestId("weather-detail-ORL");
  await expect(detail.getByTestId("weather-history").locator("tbody tr")).toHaveCount(10, { timeout: 30_000 });
  await expect(detail).toContainText("Así está hoy en Orlando");
  await expect(detail).toContainText("Open-Meteo.com");
});

test("seguridad: el carrito no confía en precios guardados en el navegador", async ({ page }) => {
  await goldenRun(page);
  const runId = page.url().split("/").pop();
  // Esperar a que el carrito se monte y guarde su estado: si no, su guardado inicial pisa el valor inyectado.
  await expect(page.getByTestId("cart-total")).toHaveText("USD 20,083.62", { timeout: 30_000 });
  // Precio adulterado para F01 (real: 4,900.00) y un alojamiento inexistente.
  await page.evaluate((key) => sessionStorage.setItem(key, JSON.stringify({
    "flight:0": { id: "F01", costMinor: 1, category: "vuelos", label: "x" }, "lodging:ORL": "H999",
  })), `travelopt:cart:${runId}:1`);
  await page.reload();
  await expect(page.getByTestId("cart-total")).toHaveText("USD 20,333.62", { timeout: 30_000 }); // F01 a precio real
  await expect(page.getByTestId("cart-delta")).toHaveText("+USD 250.00 vs. óptimo");
});

test("información legal: accesible desde el pie, no desde la portada", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).not.toContainText("Limitación de responsabilidad");
  await page.getByRole("contentinfo").getByRole("link", { name: "Información legal" }).click();
  await expect(page).toHaveURL(/\/legal$/);
  await expect(page.getByRole("heading", { name: "Información legal" })).toBeVisible();
  await expect(page.locator("main:visible")).toContainText("No somos una agencia de viajes");
  await expect(page.locator("main:visible")).toContainText("tal cual");
});

test("plan gratuito: despierta al motor al abrir el formulario y avisa si el arranque tarda", async ({ page }) => {
  const warmup = page.waitForRequest((r) => r.url().endsWith("/api/warmup"));
  const dialog = await openPreferences(page);
  await warmup; // el ping sale al abrir el modal, antes de enviar
  // Simula un motor dormido: /api/trips responde recién a los 6 s.
  await page.route("**/api/trips", async (route) => {
    await new Promise((r) => setTimeout(r, 6_000));
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(dialog.getByTestId("cold-start-notice")).toBeVisible({ timeout: 5_000 });
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
});

test("destinos dinámicos: se suman ciudades y las noches tienen que coincidir con la duración", async ({ page }) => {
  const dialog = await openForm(page);
  await goldenDestinations(dialog);
  await addCity(dialog, "Miami"); // el reparto venía cuadrado: la duración acompaña
  await expect(dialog.getByTestId("nights-allocation")).toHaveText("Noches asignadas: 16 de 16 ✓");
  await dialog.getByLabel("Duración total del viaje (noches)").fill("12");
  await expect(dialog.getByTestId("nights-allocation")).toHaveText("Noches asignadas: 16 de 12");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Asignaste 16 noches y el viaje dura 12: sobran 4.");
  await dialog.getByLabel("Duración total del viaje (noches)").fill("");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("alert")).toContainText("La duración del viaje tiene que ser de 1 a 60 noches.");
  await dialog.getByLabel("Duración total del viaje (noches)").fill("16");
  await expect(dialog.getByTestId("nights-allocation")).toHaveText("Noches asignadas: 16 de 16 ✓");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByText("¿Cuándo y cuántos?")).toBeVisible();
});

test("demo reactiva: Miami responde a noches y viajeros, y la vuelta se calcula con la ida", async ({ page }) => {
  async function miami(nights: string, pax: string) {
    const dialog = await openForm(page);
    await addCity(dialog, "Miami");
    await nightsOf(dialog, "Miami").fill(nights);
    await dialog.getByRole("button", { name: "Siguiente" }).click();
    const ida = dialog.getByLabel("Fecha de ida (primera noche)");
    await expect(ida).toHaveAttribute("min", /^\d{4}-\d{2}-\d{2}$/);
    await ida.fill("2027-07-08");
    await expect(dialog.getByLabel("Fecha de vuelta")).toHaveValue(nights === "5" ? "2027-07-13" : "2027-07-15");
    await dialog.getByLabel("Viajeros").fill(pax);
    await dialog.getByRole("button", { name: "Siguiente" }).click();
    await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
    const status = page.locator("[data-testid=run-status]:visible");
    await expect(status).toHaveText("done", { timeout: 60_000 });
    await expect(page.getByTestId("fixture-notice")).toBeVisible();
    return page.locator("[data-testid=best-total]:visible").innerText();
  }
  const a = await miami("5", "5");
  const b = await miami("7", "2");
  expect(a).not.toEqual(b);
  await page.getByTestId("step-MIA").click();
  await expect(page.locator("#city-MIA")).toContainText("Hotel 4★ Miami Centro");
});

test("fechas: elegir la vuelta recalcula las noches y el pasado se rechaza", async ({ page }) => {
  const dialog = await openForm(page);
  await goldenDestinations(dialog);
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByLabel("Fecha de ida (primera noche)").fill("2027-07-08");
  await expect(dialog.getByLabel("Fecha de vuelta")).toHaveValue("2027-07-20");
  await expect(dialog.getByLabel("Fecha de vuelta")).toHaveAttribute("min", "2027-07-09");
  await dialog.getByLabel("Fecha de vuelta").fill("2027-07-22");
  await expect(dialog.getByTestId("trip-length")).toHaveText("14 noches · Orlando 8 + Nueva York 6");
  await dialog.getByLabel("Fecha de ida (primera noche)").fill("2020-01-01");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("alert")).toContainText("La fecha de ida no puede estar en el pasado.");
});

test("nuevo viaje: el formulario vuelve a cero (hoy, sin destinos) y los destinos son toggle", async ({ page }) => {
  await goldenRun(page);
  await page.getByRole("link", { name: "Nuevo viaje" }).click();
  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "Armamos tu viaje" }).click();
  const dialog = page.getByRole("dialog", { name: "Armemos tu viaje" });
  await expect(dialog.getByText("Paso 1 de 3")).toBeVisible();
  await expect(dialog.getByTestId("nights-allocation")).toHaveCount(0); // sin destinos elegidos
  await addCity(dialog, "Miami");
  await expect(dialog.getByTestId("stop-MIA")).toBeVisible();
  await dialog.getByRole("button", { name: "Quitar MIA" }).click();
  await expect(dialog.getByTestId("stop-MIA")).toHaveCount(0);
  await dialog.getByRole("combobox").fill("filadelfia"); // sin mayúsculas ni acentos
  await expect(dialog.getByRole("option", { name: /^Filadelfia/ })).toBeVisible();
  await dialog.getByRole("combobox").fill("París"); // fuera del catálogo de la Fase 1
  await expect(dialog.getByText("Todavía no tenemos")).toBeVisible();
  await expect(dialog.getByTestId("beta-scope")).toContainText("Costa Este de EE. UU.");
  await expect(dialog.getByRole("combobox")).toHaveAccessibleDescription(/Fase de prueba \(Beta\)/);
  await dialog.getByRole("combobox").fill("Ciudad Inventada");
  await expect(dialog.getByText("Todavía no tenemos")).toBeVisible();
  await addCity(dialog, "Miami");
  await dialog.getByRole("button", { name: "Sumar 1 · Noches en Miami" }).click();
  await expect(nightsOf(dialog, "Miami")).toHaveValue("5");
  await expect(dialog.getByTestId("nights-allocation")).toHaveText("Noches asignadas: 5 de 5 ✓");
  await expect(dialog.getByRole("button", { name: /caso de ejemplo/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  const today = await page.evaluate(() => {
    const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  });
  await expect(dialog.getByLabel("Fecha de ida (primera noche)")).toHaveValue(today);
  await expect(dialog.getByLabel("Fecha de ida (primera noche)")).toHaveAttribute("min", today);
});

test("ciudad: mapa de OpenStreetMap, alojamientos con estrellas y etiquetas, y links para comparar", async ({ page }) => {
  const dialog = await openForm(page);
  await addCity(dialog, "Boston");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByLabel("Fecha de ida (primera noche)").fill("2027-05-10");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page.locator("[data-testid=run-status]:visible")).toHaveText("done", { timeout: 60_000 });
  await expect(page.getByTestId("tag-best").first()).toBeVisible(); // vuelos
  await expect(page.getByRole("link", { name: "Skyscanner" }).first()).toHaveAttribute("target", "_blank");
  await page.getByTestId("step-BOS").click();
  const boston = page.locator("#city-BOS");
  await expect(boston.getByTestId("city-map")).toBeVisible();
  await expect(boston.locator(".leaflet-tile-pane")).toBeAttached();
  await expect(boston.getByText("de menor a mayor precio")).toBeVisible();
  expect(await boston.locator("[data-testid^=lodging-]").count()).toBeGreaterThanOrEqual(6);
  await expect(boston.getByLabel("4 estrellas")).toBeVisible();
  await expect(boston.getByRole("link", { name: "Booking" })).toHaveAttribute("rel", "noopener noreferrer");
});

test("contexto espacial e impresión: mapa con alojamiento y actividades, distancias y PDF limpio", async ({ page }) => {
  await goldenRun(page);
  await page.getByTestId("step-ORL").click();
  const orl = page.locator("#city-ORL");
  await expect(orl.getByTestId("map-legend")).toBeVisible();
  await expect(orl.locator(".leaflet-interactive").first()).toBeAttached(); // marcadores dibujados
  await expect(orl.getByTestId("activity-distance").first()).toContainText(/km · ~\d+ min (a pie|en auto) desde el alojamiento/);
  await expect(orl.getByTestId("activity-thumb").first()).toBeVisible();
  // Impresión: solo el itinerario completo, sin controles
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(page.getByTestId("timeline")).toBeVisible({ timeout: 30_000 }); // en `next dev` el chunk puede estar compilando
  await expect(page.getByRole("navigation", { name: "Pasos del viaje" })).toBeHidden();
  await expect(page.getByLabel("Subtotal del viaje")).toBeHidden();
  await expect(page.getByTestId("print")).toBeHidden();
});

test("V1: deportes reales sin fechas inventadas, sellos de ejemplo, cookies de sesión y CSP con nonce", async ({ page, context }) => {
  const res = await page.goto("/");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{16,}' 'strict-dynamic'/);
  expect(csp.split(";").find((d) => d.trim().startsWith("script-src"))).not.toContain("unsafe-inline");
  const dialog = await openForm(page);
  await addCity(dialog, "Boston");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByLabel("Fecha de ida (primera noche)").fill("2027-07-08");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page.locator("[data-testid=run-status]:visible")).toHaveText(/done/, { timeout: 60_000 });
  // la sesión anónima vive solo mientras dure el navegador: ninguna cookie de Supabase con vencimiento
  const sb = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(sb.length).toBeGreaterThan(0);
  expect(sb.every((c) => c.expires === -1)).toBe(true);
  // el sello de ejemplo sigue en cada tarjeta, dentro de su ⓘ, y el aviso general de la página queda a la vista
  await expect(page.getByTestId("fixture-notice")).toBeVisible();
  await expect(page.getByTestId("demo-badge").first()).toBeAttached();
  await page.getByTestId("step-BOS").click();
  const sports = page.locator("#city-BOS").getByTestId("sports");
  await expect(sports.getByText("Boston Red Sox")).toBeVisible();
  await expect(sports.getByText("Fenway Park")).toBeVisible();
  const link = sports.getByRole("link", { name: "Ver calendario oficial y entradas" }).first();
  await expect(link).toHaveAttribute("href", /^https:\/\/www\.ticketmaster\.com\/search\?q=/);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(sports).not.toContainText(/\d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/); // sin fechas
  await expect(page.locator("#city-BOS").getByRole("link", { name: "Airbnb" })).toHaveAttribute("rel", "noopener noreferrer");
  await page.getByTestId("step-viaje").click();
  await expect(page.getByTestId("buy-timing")).toContainText("Próximamente");
});

test("zero dead-ends: si falla la carga de resultados se puede reintentar sin recargar", async ({ page }) => {
  let offline = true; // la carga de itinerarios falla (corte de red simulado) hasta que vuelve la red
  await page.route("**/rest/v1/itineraries*", (route) => (offline ? route.abort("failed") : route.continue()));
  await goldenRun(page);
  const alert = page.getByTestId("retry-alert");
  // el cliente de Supabase reintenta los GET con backoff antes de rendirse: recién ahí aparece "Reintentar"
  await expect(alert).toContainText("no pudimos cargar los resultados", { timeout: 30_000 });
  offline = false;
  await alert.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByTestId("best-total")).toHaveText("USD 20,083.62");
  await expect(alert).toHaveCount(0);
});

test("zero dead-ends: corrida inexistente ofrece volver a armar un viaje", async ({ page }) => {
  await goldenRun(page); // asegura sesión
  await page.goto("/runs/00000000-0000-4000-8000-000000000000");
  await expect(page.getByTestId("run-missing")).toContainText("no encontrada");
  await page.getByRole("link", { name: "Armar un viaje nuevo →" }).click();
  await expect(page).toHaveURL("/");
});

test("release: total en pesos y eventos con degradación elegante (APIs simuladas en el borde)", async ({ page }) => {
  const day = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await page.route("**/api/fx", (r) => r.fulfill({ json: {
    tarjeta: { venta: 2041, updatedAt: "2026-11-03T18:00:00.000Z" },
    mep: { venta: 1581.1, updatedAt: "2026-11-03T20:57:00.000Z" }, source: "dolarapi.com" } }));
  await page.route("**/api/events?*", (r) => r.fulfill({ json: { events: [{
    id: "ticketmaster:1", source: "ticketmaster", name: "Orlando Magic vs. Miami Heat", date: day, time: "19:00",
    venue: "Kia Center", category: "Sports", price_min_minor: 3550, price_max_minor: 41000,
    link: "https://www.ticketmaster.com/event/1", fetched_at: new Date().toISOString() }], sources: {} } }));
  await goldenRun(page);
  await expect(page.getByTestId("ars-tarjeta")).toContainText("40.990.668");
  await expect(page.getByTestId("ars-mep")).toContainText("31.754.212");
  await page.getByTestId("step-ORL").click();
  const ev = page.locator("#city-ORL").getByTestId("city-event").first();
  await expect(ev).toContainText("Orlando Magic vs. Miami Heat");
  await expect(ev).toContainText("Desde USD 35.50 hasta USD 410.00");
  await ev.getByRole("button", { name: "Ayuda" }).click();
  await expect(ev.getByTestId("quote-badge")).toBeVisible();

  // Si las dos APIs fallan, sus secciones desaparecen y el resto del resultado sigue igual.
  await page.unrouteAll();
  await page.route("**/api/fx", (r) => r.fulfill({ status: 503, json: { code: "fx_unavailable" } }));
  await page.route("**/api/events?*", (r) => r.abort());
  await page.reload();
  await expect(page.getByTestId("best-total")).toHaveText("USD 20,083.62");
  await expect(page.getByTestId("ars-total")).toHaveCount(0);
  await page.getByTestId("step-ORL").click();
  await expect(page.locator("#city-ORL").getByTestId("lodging-thumb").first()).toBeVisible();
  await expect(page.getByTestId("city-events")).toHaveCount(0);
});

test("major release: carruseles, lugares reales, rutas por calle, calendario y link de solo lectura", async ({ page, context }) => {
  // Fuentes externas simuladas en el borde de la web (Wikidata y OSRM no se tocan desde el test).
  await page.route("**/api/places?*", (r) => r.fulfill({ json: { places: [
    { id: "Q1", name: "Lugar real de prueba", kind: "Museo", outdoor: false, lat: 28.4, lon: -81.5,
      link: "https://es.wikipedia.org/wiki/Orlando", relevance: 10 }] } }));
  await page.route("**/api/routes", (r) => r.fulfill({ json: { routes: Array.from({ length: 25 }, () => (
    { distance_m: 21000, duration_s: 1500 })) } }));
  await goldenRun(page);

  // Calendario: descarga un .ics con los vuelos y las estadías.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("calendar").click()]);
  expect(download.suggestedFilename()).toMatch(/^viaje-\d{4}-\d{2}-\d{2}\.ics$/);

  // Carrusel horizontal: las opciones se deslizan a los costados (más anchas que el contenedor) y se pueden elegir.
  await page.getByTestId("step-ORL").click();
  const orl = page.locator("#city-ORL");
  const carousel = orl.getByTestId("lodging-carousel").first(); // elegibles (los descartados tienen el suyo)
  const { scroll, client } = await carousel.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(scroll).toBeGreaterThan(client);
  await expect(orl.getByTestId("city-place").first()).toContainText("Lugar real de prueba");
  await expect(orl.getByTestId("airport-transfers")).toContainText("21 km · ~25 min en auto");
  await expect(orl.getByTestId("activity-distance").first()).toContainText("(ruta por calle)");

  // Link de solo lectura: lo abre otra persona (otro contexto, sin la sesión) y ve el itinerario.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("share").click();
  const url = await page.getByTestId("share-url").getByRole("link").getAttribute("href");
  expect(url).toMatch(/\/share\/[0-9a-f-]{36}$/);
  const guest = await context.browser()!.newPage();
  await guest.goto(url!);
  await expect(guest.getByTestId("shared-total")).toHaveText("USD 20,083.62");
  await expect(guest.getByRole("heading", { level: 1 })).toContainText("Orlando");
  await guest.close();
});

test("UI: flechas del carrusel y 'Ver en mapa' sin geocodificar, sin tocar la selección ni la consola", async ({ page }) => {
  await page.route("**/api/places?*", (r) => r.fulfill({ json: { places: [
    { id: "Q1", name: "Lugar real de prueba", kind: "Museo", outdoor: false, lat: 28.4, lon: -81.5,
      link: "https://es.wikipedia.org/wiki/Orlando", relevance: 10 }] } }));
  await goldenRun(page);

  // Vuelos → "Ver en mapa" lleva al paso de la ciudad y el mapa vuela al aeropuerto (coordenadas estáticas).
  const flight = page.locator("[data-testid^=flight-]").filter({ hasText: "MCO" }).first();
  await flight.getByTestId("map-focus-button").click();
  const orl = page.locator("#city-ORL");
  await expect(orl.getByTestId("map-focus-status")).toHaveText("Mostrando en el mapa: Aeropuerto Orlando (MCO)");

  // Desde acá, ninguna request nueva salvo tiles del mapa: nada de geocodificación ni APIs externas.
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  // Carrusel: con mouse hay flechas; "siguiente" desliza la fila y habilita "anterior".
  const lodging = orl.getByTestId("lodging-carousel").first();
  const wrap = lodging.locator("..");
  await expect(wrap.getByTestId("carousel-prev")).toBeDisabled();
  await wrap.getByTestId("carousel-next").click();
  // Avanza casi un ancho visible (o hasta el final si queda menos): al terminar, "siguiente" se apaga si no hay más.
  await expect.poll(() => lodging.evaluate((el) =>
    el.scrollLeft >= Math.min(el.clientWidth * 0.5, el.scrollWidth - el.clientWidth - 2))).toBe(true);
  await expect(wrap.getByTestId("carousel-prev")).toBeEnabled();
  await wrap.getByTestId("carousel-prev").click();
  await expect.poll(() => lodging.evaluate((el) => el.scrollLeft)).toBeLessThan(5);
  await expect(wrap.getByTestId("carousel-prev")).toBeDisabled();

  // Alojamiento: "Ver en mapa" resalta el pin y NO cambia la selección ni el subtotal.
  const subtotal = await page.getByLabel("Subtotal del viaje").innerText();
  const selected = await lodging.getByRole("button", { name: "✓ Seleccionado" }).count();
  const card = lodging.locator("article").filter({ has: page.getByRole("button", { name: "Seleccionar", exact: true }) }).first();
  const name = (await card.locator("p.font-semibold").first().innerText()).trim();
  await card.getByTestId("map-focus-button").click();
  await expect(orl.getByTestId("map-focus-status")).toHaveText(`Mostrando en el mapa: ${name}`);
  await expect(orl.locator("path.map-focus-ring")).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Seleccionar", exact: true })).toBeEnabled();
  expect(await lodging.getByRole("button", { name: "✓ Seleccionado" }).count()).toBe(selected);
  expect(await page.getByLabel("Subtotal del viaje").innerText()).toBe(subtotal);

  // Actividades: la tarjeta es un <label>; el botón no marca el checkbox (no aparece "Optimizar calendario").
  const activity = orl.getByTestId("activity-carousel").getByRole("listitem").first();
  const box = activity.getByRole("checkbox");
  const before = await box.isChecked();
  await activity.getByTestId("map-focus-button").click();
  await expect(orl.getByTestId("map-focus-status")).toContainText("Mostrando en el mapa:");
  expect(await box.isChecked()).toBe(before);
  await expect(page.getByRole("button", { name: /Optimizar calendario/ })).toHaveCount(0);

  // Lugares (Wikidata, ya cargados) y estadios (tabla estática) también vuelan al punto.
  await orl.getByTestId("city-place").first().getByTestId("map-focus-button").click();
  await expect(orl.getByTestId("map-focus-status")).toHaveText("Mostrando en el mapa: Lugar real de prueba");
  await orl.getByTestId("sports-team").first().getByTestId("map-focus-button").click();
  await expect(orl.getByTestId("map-focus-status")).toHaveText("Mostrando en el mapa: Kia Center");

  // Vuelos repetidos a mitad de animación y cambio de paso con el mapa volando: sin "_leaflet_pos" (afterEach).
  await orl.getByTestId("city-place").first().getByTestId("map-focus-button").click();
  await page.getByTestId("step-NYC").click();
  await expect(page.locator("#city-NYC").getByTestId("city-map")).toBeVisible();
  await page.waitForTimeout(1200); // deja terminar cualquier frame pendiente del vuelo anterior

  // Permitido: tiles, assets, lo que el paso de NYC ya cargaba (lugares, eventos, rutas…) y el sondeo de estado de la
  // corrida contra Supabase propia. Nada más.
  const unexpected = requests.filter((u) => !/\/api\/tiles\/|\/_next\/|\/api\/(places|events|routes|fx|photo|price-advice)\b|__nextjs|\/rest\/v1\/|\/realtime\/|\.(js|css|woff2?)(\?|$)/.test(u));
  expect(unexpected).toEqual([]);
  expect(requests.filter((u) => /geocod|nominatim|maps\.googleapis|photon|mapbox/i.test(u))).toEqual([]);
});

test("microcopy: ayudas ⓘ con mouse, teclado y toque, sin desbordar; exigir cocina sin el dato no inventa", async ({ page, browser }) => {
  const dialog = await openPreferences(page);
  await expect(dialog.getByLabel("Baños mínimos")).toHaveCount(1); // la ayuda no ensucia el nombre del campo
  const help = dialog.getByRole("button", { name: "Ayuda" });
  await expect(help).toHaveCount(4); // baños, escalas, valijas y cocina
  const tip = page.getByRole("tooltip");
  // mouse: aparece al pasar por encima y explica cómo se cuentan los baños
  await help.first().hover();
  await expect(tip.filter({ visible: true })).toContainText("1 baño privado por habitación");
  // Esc cierra la ayuda, no el formulario
  await page.keyboard.press("Escape");
  await expect(tip.filter({ visible: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  // teclado: Tab desde el campo de baños enfoca la ayuda de escalas y la abre
  await dialog.getByLabel("Baños mínimos").focus();
  await page.keyboard.press("Tab");
  await expect(tip.filter({ visible: true })).toContainText("cada tramo de vuelo");
  await page.keyboard.press("Escape");

  // exigir cocina: el caso de prueba no informa cocina -> sin itinerario y con el motivo, nunca un supuesto
  await dialog.getByTestId("require-kitchen").check();
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("infeasible", { timeout: 60_000 });
  await expect(page.getByTestId("suggestions")).toContainText("Desactivá \"Exigir cocina\"");

  // táctil (375 px): tocar abre y vuelve a tocar cierra; la burbuja entra en la pantalla y no hay scroll horizontal
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const phone = await ctx.newPage();
  const d2 = await openPreferences(phone);
  const kitchenHelp = d2.getByRole("button", { name: "Ayuda" }).last();
  await kitchenHelp.tap();
  const bubble = phone.getByRole("tooltip").filter({ visible: true });
  await expect(bubble).toContainText("alquileres temporarios");
  const box = (await bubble.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(d2.getByTestId("require-kitchen")).not.toBeChecked(); // tocar la ayuda no marca el filtro
  await kitchenHelp.tap();
  await expect(bubble).toHaveCount(0);
  await ctx.close();
});

test("cold start: mientras el motor resuelve ya se ve el recorrido, y la tarjeta agrupa sus datos en un ⓘ", async ({ page }) => {
  const dialog = await openPreferences(page);
  // Corrida "en curso" sostenida: sin Realtime y con el sondeo de estado devolviendo optimizing.
  await page.routeWebSocket(/realtime/, () => undefined);
  await page.route(/\/rest\/v1\/search_runs\?select=id%2Cstatus/, async (r) => {
    const res = await r.fetch();
    const body = await res.json();
    await r.fulfill({ response: res, json: { ...body, status: "optimizing" } });
  });
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const preview = page.getByTestId("trip-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByRole("img", { name: /Recorrido: .*Orlando → Nueva York/ })).toBeVisible();
  await expect(preview).toContainText("Orlando · 8 noches");
  await expect(page.getByTestId("trip-fact")).toContainText("¿Sabías que…?");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
  await expect(preview).toHaveCount(0);

  // Tarjeta de alojamiento: lo secundario no está a la vista hasta abrir su único ⓘ
  await page.getByTestId("step-ORL").click();
  const card = page.locator("#city-ORL").getByTestId("lodging-H2");
  await expect(card.getByTestId("demo-badge")).toBeHidden();
  await card.getByRole("button", { name: "Ayuda" }).click();
  await expect(card.getByTestId("demo-badge")).toBeVisible();
  await expect(card.getByRole("button", { name: "Ayuda" })).toHaveCount(1);
  await expect(card.locator("svg").first()).toBeAttached(); // ícono SVG, no emoji
});
