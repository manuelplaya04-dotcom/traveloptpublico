// Accesibilidad automática (axe-core, WCAG 2.1 A/AA): sin violaciones serias ni críticas en las pantallas clave.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

// Sin animaciones: axe mide el contraste final, no un cuadro a mitad de un fundido (opacidad < 1).
test.use({ reducedMotion: "reduce" });

async function audit(page: Page, scope?: string) {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude(".leaflet-container"); // mapa de terceros: sus controles no son nuestros
  const { violations } = await (scope ? builder.include(scope) : builder).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} → ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

test("a11y: portada", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Armamos tu viaje" })).toBeEnabled();
  await audit(page);
});

test("a11y: formulario (los tres pasos)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Armamos tu viaje" }).click();
  const dialog = page.getByRole("dialog", { name: "Armemos tu viaje" });
  await dialog.getByRole("combobox").fill("Boston");
  await dialog.getByRole("option", { name: /^Boston/ }).click();
  await audit(page, "dialog");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await audit(page, "dialog");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await audit(page, "dialog");
});

test("a11y: resultado y ciudad", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Armamos tu viaje" }).click();
  const dialog = page.getByRole("dialog", { name: "Armemos tu viaje" });
  await dialog.getByRole("combobox").fill("Boston");
  await dialog.getByRole("option", { name: /^Boston/ }).click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();
  await expect(page.getByTestId("best-total")).toBeVisible({ timeout: 60_000 });
  await audit(page);
  await page.getByTestId("step-BOS").click();
  await expect(page.locator("#city-BOS")).toBeVisible();
  await audit(page);
});
