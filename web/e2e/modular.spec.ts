// Módulos opcionales y recorrido guiado. Requiere motor (8000) y Supabase local, como golden.spec.ts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const pageErrors = new Map<object, Error[]>();
test.beforeEach(({ page }) => {
  const errors: Error[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (e) => errors.push(e));
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

const skip = (page: Page, ids: string[]) => page.addInitScript((list) => {
  for (const id of list) localStorage.setItem(`travelopt:tour:${id}:v1`, "1");
}, ids);

test("tour: aparece la primera vez anclado a los módulos, se recorre y no vuelve a aparecer", async ({ page }) => {
  await openForm(page);
  const tour = page.getByTestId("guided-tour");
  await expect(tour).toContainText("¿Ya tenés pasajes o alojamiento?");
  await expect(tour).toBeFocused();
  const { violations } = await new AxeBuilder({ page }).include("[data-testid=guided-tour]")
    .withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await page.getByTestId("tour-next").click();
  await expect(tour).toContainText("Elegí tus destinos");
  await page.getByTestId("tour-next").click();
  await expect(tour).toContainText("3 de 3");
  await page.getByTestId("tour-next").click(); // "Entendido"
  await expect(tour).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Armemos tu viaje" })).toBeVisible(); // el formulario sigue abierto

  await page.reload();
  await openForm(page);
  await page.waitForTimeout(1_000); // más que la espera de arranque del recorrido
  await expect(page.getByTestId("guided-tour")).toHaveCount(0);
});

test("tour: Esc lo cierra sin cerrar el formulario", async ({ page }) => {
  const dialog = await openForm(page);
  await expect(page.getByTestId("guided-tour")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("guided-tour")).toBeHidden();
  await expect(dialog).toBeVisible();
});

test("sin ningún servicio no se puede avanzar y se explica por qué", async ({ page }) => {
  await skip(page, ["onboarding"]);
  const dialog = await openForm(page);
  for (const k of ["flights", "lodging", "activities"]) await dialog.getByTestId(`service-${k}`).click();
  await expect(dialog.getByTestId("service-flights")).toHaveAttribute("aria-checked", "false");
  await expect(dialog.getByRole("alert").first()).toHaveText("Debes seleccionar al menos un servicio.");
  await addCity(dialog, "Orlando");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByText("Paso 1 de 3")).toBeVisible();
});

test("sin vuelos: no pide origen ni escalas, y el itinerario arranca en el destino", async ({ page }) => {
  await skip(page, ["onboarding", "results"]);
  const dialog = await openForm(page);
  await dialog.getByTestId("service-flights").click();
  await addCity(dialog, "Orlando");
  await addCity(dialog, "Nueva York");
  await dialog.getByRole("spinbutton", { name: "Noches en Orlando" }).fill("8");
  await dialog.getByRole("spinbutton", { name: "Noches en Nueva York" }).fill("4");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByLabel("Salís desde")).toHaveCount(0);
  await dialog.getByLabel("Primera noche del viaje").fill("2027-07-08");
  await dialog.getByLabel("Viajeros").fill("5");
  await dialog.getByLabel("Presupuesto total (USD)").fill("21000");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByLabel("Escalas máximas")).toHaveCount(0);
  await expect(dialog.getByLabel("Baños mínimos")).toBeVisible();
  await dialog.getByRole("button", { name: "Optimizar itinerario" }).click();

  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("run-status")).toHaveText("done", { timeout: 60_000 });
  await expect(page.getByTestId("step-vuelos")).toHaveCount(0);
  const best = await page.getByTestId("best-total").textContent();
  await expect(page.getByTestId("cart-total")).toHaveText(best ?? "");
  await page.getByTestId("step-viaje").click();
  await expect(page.getByTestId("rubro-vuelos")).toHaveCount(0);
  await expect(page.getByTestId("checkout-total")).toHaveText(best ?? "");
});
