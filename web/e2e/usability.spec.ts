// Mejoras de la prueba de usabilidad: sin franja horaria oculta, fechas de ida y vuelta, detalle de vuelos, filtro por
// hora de llegada y aviso Beta minimizable. Requiere motor (8000) y Supabase local, como golden.spec.ts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { skipTours } from "./tour";

const pageErrors = new Map<object, Error[]>();
test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (e) => errors.push(e));
  await skipTours(page);
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

async function run(page: Page, dialog: Locator) {
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 90_000 });
}

// Caso golden: es el que fija una franja horaria explícita (6:00 a 23:00).
async function goldenRun(page: Page) {
  const dialog = await openForm(page);
  await addCity(dialog, "Orlando");
  await addCity(dialog, "Nueva York");
  await dialog.getByRole("spinbutton", { name: "Noches en Orlando" }).fill("8");
  await dialog.getByRole("spinbutton", { name: "Noches en Nueva York" }).fill("4");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByLabel("Fecha de ida (primera noche)").fill("2027-07-08");
  await dialog.getByLabel("Flexibilidad de ida (días)").fill("1");
  await dialog.getByLabel("Viajeros").fill("5");
  await dialog.getByLabel("Presupuesto total (USD)").fill("21000");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByLabel("Salir desde las").selectOption("6");
  await dialog.getByLabel("Llegar hasta las").selectOption("23");
  await run(page, dialog);
  await expect(page.getByTestId("best-total")).toHaveText("USD 20,083.62"); // mismo pedido que el fixture
}

test("aviso Beta: se minimiza con un botón accesible, se recuerda y se vuelve a abrir", async ({ page }) => {
  const dialog = await openForm(page);
  const toggle = dialog.getByTestId("beta-scope-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true"); // por defecto, abierto
  await expect(dialog.locator("#beta-scope-list")).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(dialog.locator("#beta-scope-list")).toBeHidden();
  await expect(dialog.getByTestId("beta-scope")).toContainText("Fase de prueba (Beta)"); // el título queda
  await expect(dialog.getByRole("combobox")).toHaveAccessibleDescription(/Fase de prueba \(Beta\)/);
  const { violations } = await new AxeBuilder({ page }).include("[data-testid=beta-scope]").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await page.reload();
  const again = await openForm(page);
  await expect(again.getByTestId("beta-scope-toggle")).toHaveAttribute("aria-expanded", "false");
  await again.getByTestId("beta-scope-toggle").click();
  await expect(again.locator("#beta-scope-list")).toBeVisible();
});

test("viaje nuevo: sin franja horaria oculta, nada se descarta 'por tu hora mínima'", async ({ page }) => {
  const dialog = await openForm(page);
  await addCity(dialog, "Miami");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByLabel("Fecha de ida (primera noche)").fill("2027-07-08");
  await dialog.getByLabel("Viajeros").fill("2");
  await dialog.getByLabel("Presupuesto total (USD)").fill("8000");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await run(page, dialog);
  await expect(page.getByText(/hora mínima|hora máxima/)).toHaveCount(0);
  await expect(page.getByTestId("trip-depart")).toBeVisible();
  await expect(page.getByTestId("trip-return")).toBeVisible();
});

test("vuelos: fechas de ida y vuelta, detalle sin inventar y filtro por hora de llegada con la selección consistente", async ({ page }) => {
  await goldenRun(page);
  // Cabecera y carril: Ida y Vuelta explícitas.
  await expect(page.getByTestId("trip-depart")).not.toBeEmpty();
  await expect(page.getByTestId("trip-return")).not.toBeEmpty();
  // El caso de prueba no trae números de vuelo ni aeropuertos de escala: se dice, no se deduce.
  const card = page.locator("[data-testid^=flight-F]").first();
  await expect(card.getByTestId("flight-numbers")).toContainText("número de vuelo no informado");
  await expect(card).toContainText("aeropuerto no informado");

  const total = await page.getByTestId("cart-total").textContent();
  const filter = page.getByTestId("arrive-by-0");
  await filter.selectOption("8");
  await expect(page.getByText(/de \d+ opciones llegan a tiempo/).first()).toBeVisible();
  // El óptimo de ida (F02) llega 21:40: se mantiene elegido (total intacto), se avisa y se ofrece F01 (07:10) a un clic.
  const outside = page.getByTestId("arrival-outside");
  await expect(outside).toContainText("llega a las 21:40");
  const { violations } = await new AxeBuilder({ page }).include("#flight-panel").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await expect(page.getByTestId("flight-F02")).toHaveCount(0); // fuera del filtro: no se lista
  await expect(page.getByTestId("cart-total")).toHaveText(total ?? "");
  await page.getByTestId("arrival-pick").click();
  await expect(outside).toHaveCount(0);
  await expect(page.getByTestId("flight-F01").getByRole("button", { name: "✓ Seleccionado" })).toBeVisible();
  await expect(page.getByTestId("cart-total")).not.toHaveText(total ?? "");
  await filter.selectOption("");
  await expect(page.getByText("Hora local de llegada").first()).toBeVisible();

  // Carril del itinerario: cada vuelo dice qué tramo es.
  await page.getByTestId("step-viaje").click();
  const roles = page.getByTestId("timeline-flight-role");
  await expect(roles.first()).toHaveText("Ida:");
  await expect(roles.last()).toHaveText("Vuelta:");
});

test("celular (375 px): aviso Beta, filtro de llegada y escalas sin scroll horizontal", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const phone = await ctx.newPage();
  await skipTours(phone);
  const dialog = await openForm(phone);
  await dialog.getByTestId("beta-scope-toggle").tap();
  await expect(dialog.getByTestId("beta-scope-toggle")).toHaveAttribute("aria-expanded", "false");
  await phone.screenshot({ path: test.info().outputPath("beta-minimizado-375.png") });
  await dialog.getByTestId("beta-scope-toggle").tap(); // lo deja como estaba para los demás tests de este navegador
  await addCity(dialog, "Miami");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByLabel("Fecha de ida (primera noche)").fill("2027-07-08");
  await dialog.getByLabel("Viajeros").fill("2");
  await dialog.getByLabel("Presupuesto total (USD)").fill("8000");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await run(phone, dialog);
  await phone.getByTestId("arrive-by-0").selectOption("12");
  await phone.getByTestId("arrive-by-0").scrollIntoViewIfNeeded();
  await phone.screenshot({ path: test.info().outputPath("vuelos-filtro-375.png") });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "scroll horizontal en px").toBeLessThanOrEqual(0);
  await ctx.close();
});
