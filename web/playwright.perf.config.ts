import { defineConfig } from "@playwright/test";

// Presupuesto de rendimiento (perf/*.perf.ts): siempre contra el build de producción, nunca `next dev` (que es varias
// veces más lento y no representa lo que ve la persona). Un solo worker: las mediciones no compiten por la CPU.
const PORT = 3100;
export default defineConfig({
  testDir: "./perf",
  testMatch: "*.perf.ts",
  workers: 1,
  retries: process.env.CI ? 1 : 0, // una máquina compartida del CI puede tener un pico aislado
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 800 } },
  webServer: {
    command: `npx next start -H localhost -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
