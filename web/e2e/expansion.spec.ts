// Fecha mínima, ruta óptima (orden libre), destinos nuevos y precios en pesos. Requiere motor (8000) y Supabase local.
import { expect, test, type Locator, type Page } from "@playwright/test";

const pageErrors = new Map<object, Error[]>();
test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (e) => errors.push(e));
  await page.addInitScript(() => {
    for (const id of ["onboarding", "results"]) localStorage.setItem(`travelopt:tour:${id}:v1`, "1");
  });
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)?.map((e) => e.message) ?? []).toEqual([]);
});

async function openForm(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: "Armamos tu viaje" }).click();
  const dialog = page.getByRole("dialog", { name: "Armemos tu viaje" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function addCity(dialog: Locator, name: string) {
  await dialog.getByRole("combobox").fill(name);
  await dialog.getByRole("option", { name: new RegExp(`^${name}`) }).first().click();
}

async function datesAndGo(page: Page, dialog: Locator, pax = "2", budget = "15000") {
  await dialog.getByLabel("Fecha de ida (primera noche)").fill("2027-07-08");
  await dialog.getByLabel("Viajeros").fill(pax);
  await dialog.getByLabel("Presupuesto total (USD)").fill(budget);
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 90_000 });
}

const localIso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

test("fecha mínima: el calendario explica el margen y una ida de hoy no deja avanzar", async ({ page }) => {
  const dialog = await openForm(page);
  await addCity(dialog, "Orlando");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByTestId("depart-hint")).toContainText("con menos de 48 h casi no quedan vuelos");
  const today = localIso(new Date());
  const ida = dialog.getByLabel("Fecha de ida (primera noche)");
  await expect(ida).toHaveAttribute("min", localIso(new Date(Date.now() + 2 * 86_400_000)));
  await ida.fill(today);
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("La primera noche puede ser desde el");
  await expect(dialog.getByText("Paso 2 de 3")).toBeVisible(); // no avanzó
});

test("ruta óptima: el motor elige el orden y el resultado lo dice", async ({ page }) => {
  const dialog = await openForm(page);
  for (const c of ["Orlando", "Nueva York", "Miami"]) await addCity(dialog, c);
  const sw = dialog.getByTestId("optimize-order");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(sw).toContainText("Probamos los 6 órdenes posibles");
  await expect(dialog.getByRole("button", { name: "Subir NYC" })).toHaveCount(0); // sin orden manual
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await datesAndGo(page, dialog);
  await expect(page.getByText("Este recorrido lo eligió el optimizador")).toBeVisible();
  await expect(page.getByTestId("try-best-order")).toHaveCount(0);
});

test("Patagonia y Brasil: zonas que comparten aeropuerto no se combinan; Bariloche + Río llega al itinerario", async ({ page }) => {
  const dialog = await openForm(page);
  await expect(dialog.getByTestId("beta-scope")).toContainText("Patagonia argentina");
  await addCity(dialog, "Río de Janeiro");
  await addCity(dialog, "Búzios");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("comparten aeropuertos");
  await dialog.getByRole("button", { name: "Quitar BUZ" }).click();
  await addCity(dialog, "Bariloche");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByLabel("Salís desde").selectOption("BUE");
  await datesAndGo(page, dialog);
  await page.getByTestId("step-BAR").click();
  await expect(page.locator("#city-BAR")).toContainText("moneda local ARS");
});

// Cotización fija para que la prueba no dependa de dolarapi.com.
const RATES = {
  tarjeta: { cents_per_usd: 200000, updated_at: "2026-11-13T18:00:00Z" },
  mep: { cents_per_usd: 150000, updated_at: "2026-11-13T18:00:00Z" },
  source: "dolarapi.com", fetched_at: "2026-11-13T18:01:00Z", stale: false,
};
const usdToArs = (usd: string, cents: number) => {
  const minor = Number(usd.replace(/[^\d]/g, ""));
  return `$ ${Math.floor((minor * cents + 5_000) / 10_000).toLocaleString("es-AR")}`;
};

test("precios en pesos: el selector convierte total y carrito, se recuerda y, sin cotización, quedan en USD", async ({ page }) => {
  await page.route("**/api/fx", (r) => r.fulfill({ json: RATES }));
  const dialog = await openForm(page);
  await addCity(dialog, "Miami");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await datesAndGo(page, dialog);
  const usd = (await page.getByTestId("best-total").textContent()) ?? "";
  expect(usd).toMatch(/^USD /);
  await page.getByText("Pesos · tarjeta").click();
  const norm = (s: string | null) => (s ?? "").replace(/\s/g, " ");
  await expect.poll(async () => norm(await page.getByTestId("best-total").textContent())).toBe(usdToArs(usd, 200000));
  await expect.poll(async () => norm(await page.getByTestId("cart-total").textContent())).toBe(usdToArs(usd, 200000));
  await expect(page.getByTestId("currency-note")).toContainText("2.000,00 por dólar");

  await page.reload();
  await expect.poll(async () => norm(await page.getByTestId("best-total").textContent()), { timeout: 30_000 })
    .toBe(usdToArs(usd, 200000)); // la elección se recuerda

  await page.unroute("**/api/fx");
  await page.route("**/api/fx", (r) => r.fulfill({ status: 503, json: { code: "fx_unavailable" } }));
  await page.reload();
  await expect(page.getByTestId("currency-fallback")).toContainText("mostramos los precios en USD", { timeout: 30_000 });
  await expect(page.getByTestId("best-total")).toHaveText(usd);
});
