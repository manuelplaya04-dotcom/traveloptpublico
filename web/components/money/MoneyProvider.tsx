"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { engineFxSchema, moneyFormat, type DisplayCurrency, type FxRates, type MoneyFormat } from "@/lib/fx";
import { fmtMinor } from "@/lib/money";

// Moneda en que se muestran los precios del resultado. Dos contextos separados (anti-jank):
// - `FormatContext`: solo la función de formato. Cambia cuando cambia lo que se ve (elegir otra moneda), no cuando llega
//   la cotización estando en USD. Cada precio la consume con `useMoney()`; al cambiar de moneda se redibujan solo los
//   componentes que muestran precios, una vez, y la conversión es una multiplicación de enteros por precio.
// - `FxContext`: cotización, estado y selector, para el control de moneda y el total en pesos.
// La elección se recuerda en este navegador (`localStorage`, con try/catch: en modo privado puede no existir).
const STORAGE_KEY = "travelopt:currency:v1";
const USD_FORMAT: MoneyFormat = (m) => fmtMinor(m);

type FxStatus = "loading" | "ok" | "unavailable";
type FxState = { mode: DisplayCurrency; setMode: (m: DisplayCurrency) => void; rates: FxRates | null; status: FxStatus };

const FormatContext = createContext<MoneyFormat>(USD_FORMAT);
const FxContext = createContext<FxState>({ mode: "USD", setMode: () => undefined, rates: null, status: "unavailable" });

export const useMoney = () => useContext(FormatContext);
export const useFx = () => useContext(FxContext);

function storedMode(): DisplayCurrency {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "tarjeta" || v === "mep" ? v : "USD";
  } catch {
    return "USD";
  }
}

export default function MoneyProvider({ children }: { children: ReactNode }) {
  // Se monta recién con los datos de la corrida (cargados en el navegador), nunca en el HTML del servidor: leer la
  // elección guardada al iniciar el estado no puede desalinear la hidratación.
  const [mode, setModeState] = useState<DisplayCurrency>(storedMode);
  const [rates, setRates] = useState<FxRates | null>(null);
  const [status, setStatus] = useState<FxStatus>("loading");

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/fx", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => {
        const parsed = engineFxSchema.safeParse(d);
        setRates(parsed.success ? parsed.data : null);
        setStatus(parsed.success ? "ok" : "unavailable");
      })
      .catch(() => { if (!ctl.signal.aborted) setStatus("unavailable"); });
    return () => ctl.abort();
  }, []);

  const setMode = useCallback((m: DisplayCurrency) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      // sin almacenamiento la elección vale solo para esta página
    }
  }, []);

  // En USD no depende de la cotización: que llegue no redibuja ningún precio.
  const effectiveRates = mode === "USD" ? null : rates;
  const format = useMemo(() => (effectiveRates ? moneyFormat(mode, effectiveRates) : USD_FORMAT), [mode, effectiveRates]);
  const fx = useMemo(() => ({ mode, setMode, rates, status }), [mode, setMode, rates, status]);

  return (
    <FxContext.Provider value={fx}>
      <FormatContext.Provider value={format}>{children}</FormatContext.Provider>
    </FxContext.Provider>
  );
}
