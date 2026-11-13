// Recorridos guiados (lib/tour.ts): los tests que no los prueban los marcan como vistos antes de cargar la página,
// así la burbuja no tapa los elementos que el test toca.
import type { Page } from "@playwright/test";

export const TOUR_IDS = ["onboarding", "results", "infeasible"] as const;

export async function skipTours(page: Page) {
  await page.addInitScript((ids) => {
    for (const id of ids) localStorage.setItem(`travelopt:tour:${id}:v1`, "1");
  }, [...TOUR_IDS]);
}
