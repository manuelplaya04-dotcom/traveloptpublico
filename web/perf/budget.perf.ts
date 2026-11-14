// Presupuesto de rendimiento: corre en el CI contra el build de producción (`next start`), con la CPU frenada por CDP.
// Mide en el navegador, sin instrumentar la app:
// - cuadros perdidos: intervalos de requestAnimationFrame de más de 2 cuadros (33 ms), sobre el total del tramo;
// - cuadro más largo: Long Animation Frames (LoAF), el bloqueo real del hilo principal;
// - interacción más lenta: Event Timing (lo mismo que mide INP), de la entrada del usuario al cuadro pintado.
// Los umbrales salen de medir (decisión 23 de project_guidelines.md): holgados para el ruido de una máquina del CI y por
// debajo de las regresiones reales que ya tuvimos (el velo con desenfoque perdía 3 de cada 4 cuadros en este tramo).
import { expect, test, type Page } from "@playwright/test";

const CPU_SLOWDOWN = Number(process.env.PERF_CPU_SLOWDOWN ?? 4);
const BUDGET = {
  modalSwitches: { dropped: 0.2, longestFrameMs: 250, slowestInteractionMs: 300 }, // normal 0–6%; con desenfoque, 34%
  modalScroll: { dropped: 0.12, longestFrameMs: 250 }, // normal 0–3%; con desenfoque, 17%
  landing: { longestFrameMs: 2_000 }, // la hidratación con CPU 4x mide 0,3–1,1 s: solo frena saltos grandes (JS de más)
} as const;

type Sample = { frames: number; dropped: number; longestFrameMs: number; slowestInteractionMs: number };

declare global {
  interface Window { __perf?: { frames: number[]; loaf: number[]; events: number[]; on: boolean } }
}

async function slowCpu(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
}

/** Mide lo que pasa en la página mientras corre `action` (y medio segundo después, para que termine de pintar). */
async function measure(page: Page, action: () => Promise<void>): Promise<Sample> {
  await page.evaluate(() => {
    const p = { frames: [] as number[], loaf: [] as number[], events: [] as number[], on: true };
    window.__perf = p;
    let last = performance.now();
    const tick = (t: number) => {
      p.frames.push(t - last);
      last = t;
      if (p.on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) p.loaf.push(e.duration); })
      .observe({ type: "long-animation-frame" });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) p.events.push(e.duration); })
      .observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
  });
  await action();
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const p = window.__perf!;
    p.on = false;
    const frames = p.frames.slice(1); // el primero mide desde la instalación, no un cuadro
    return {
      frames: frames.length,
      dropped: frames.length ? frames.filter((d) => d > 33.4).length / frames.length : 0,
      longestFrameMs: Math.round(Math.max(0, ...p.loaf)),
      slowestInteractionMs: Math.round(Math.max(0, ...p.events)),
    };
  });
}

const report = (name: string, s: object) => test.info().annotations.push({ type: name, description: JSON.stringify(s) });

async function openModal(page: Page) {
  await page.addInitScript(() => localStorage.setItem("travelopt:tour:onboarding:v1", "1")); // sin recorrido guiado
  await page.goto("/");
  await page.getByRole("button", { name: "Armamos tu viaje" }).click();
  const dialog = page.getByRole("dialog", { name: "Armemos tu viaje" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400); // fin de la animación de entrada
  return dialog;
}

test("portada: la carga no bloquea el hilo principal", async ({ page }) => {
  await slowCpu(page);
  await page.addInitScript(() => {
    const loaf: number[] = [];
    (window as unknown as { __loaf: number[] }).__loaf = loaf;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push(e.duration); })
      .observe({ type: "long-animation-frame", buffered: true });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Armamos tu viaje" })).toBeEnabled(); // hidratada
  await page.waitForTimeout(1_000);
  const longest = Math.round(await page.evaluate(() => Math.max(0, ...(window as unknown as { __loaf: number[] }).__loaf)));
  report("landing", { longestFrameMs: longest, cpu: CPU_SLOWDOWN });
  expect(longest, "cuadro más largo de la carga (ms)").toBeLessThan(BUDGET.landing.longestFrameMs);
});

test("modal: los switches de servicios responden sin perder cuadros", async ({ page }) => {
  const dialog = await openModal(page);
  await slowCpu(page);
  const s = await measure(page, async () => {
    for (let i = 0; i < 6; i++) {
      await dialog.getByTestId(["service-flights", "service-lodging", "service-activities"][i % 3]).click();
      await page.waitForTimeout(150);
    }
  });
  report("modalSwitches", { ...s, cpu: CPU_SLOWDOWN });
  expect(s.frames, "se midieron cuadros").toBeGreaterThan(20);
  expect(s.dropped, "proporción de cuadros perdidos").toBeLessThan(BUDGET.modalSwitches.dropped);
  expect(s.longestFrameMs, "cuadro más largo (ms)").toBeLessThan(BUDGET.modalSwitches.longestFrameMs);
  expect(s.slowestInteractionMs, "interacción más lenta (ms)").toBeLessThan(BUDGET.modalSwitches.slowestInteractionMs);
});

test("modal: el scroll del formulario es fluido", async ({ page }) => {
  const dialog = await openModal(page);
  for (const c of ["Orlando", "Nueva York", "Miami"]) { // contenido suficiente para desplazar
    await dialog.getByRole("combobox").fill(c);
    await dialog.getByRole("option", { name: new RegExp(`^${c}`) }).first().click();
  }
  await slowCpu(page);
  const box = await dialog.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const s = await measure(page, async () => {
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, i < 6 ? 220 : -220);
      await page.waitForTimeout(60);
    }
  });
  report("modalScroll", { ...s, cpu: CPU_SLOWDOWN });
  expect(s.frames, "se midieron cuadros").toBeGreaterThan(20);
  expect(s.dropped, "proporción de cuadros perdidos").toBeLessThan(BUDGET.modalScroll.dropped);
  expect(s.longestFrameMs, "cuadro más largo (ms)").toBeLessThan(BUDGET.modalScroll.longestFrameMs);
});
