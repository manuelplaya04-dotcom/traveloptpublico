"use client";

import { useFx } from "@/components/money/MoneyProvider";
import { DISPLAY_CURRENCIES, fmtRate, type DisplayCurrency } from "@/lib/fx";

const LABEL: Record<DisplayCurrency, string> = { USD: "Dólares", tarjeta: "Pesos · tarjeta", mep: "Pesos · MEP" };

// Selector de moneda de los precios (radiogroup nativo: flechas para moverse, el lector anuncia la opción). Si no hay
// cotización, los precios siguen en USD y un aviso sutil lo dice: nunca un precio vacío ni una conversión inventada.
export default function CurrencySwitch() {
  const { mode, setMode, rates, status } = useFx();
  const ars = mode !== "USD";
  const unavailable = ars && status === "unavailable";
  return (
    <div className="print:hidden">
      <fieldset className="inline-flex flex-wrap items-center gap-1 rounded-full bg-white p-1 ring-1 ring-line" data-testid="currency-switch">
        <legend className="sr-only">Ver precios en</legend>
        {DISPLAY_CURRENCIES.map((c) => (
          <label key={c} className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors
            has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
            mode === c ? "bg-accent text-white" : "text-muted hover:text-ink"}`}>
            <input type="radio" name="display-currency" value={c} checked={mode === c} onChange={() => setMode(c)}
              className="sr-only" data-testid={`currency-${c}`} />
            {LABEL[c]}
          </label>
        ))}
      </fieldset>
      {ars && rates && status === "ok" && (
        <p className="mt-1 text-xs text-muted" data-testid="currency-note">
          Referencia a {fmtRate(rates[mode].cents_per_usd)} por dólar ({rates.source}
          {rates.stale ? ", última cotización guardada" : ""}). Cobran y concilian en USD.
        </p>
      )}
      {(unavailable || (ars && status === "loading")) && (
        <p role="status" className="mt-1 text-xs text-muted" data-testid="currency-fallback">
          {unavailable ? "No pudimos obtener la cotización del dólar: mostramos los precios en USD." : "Buscando la cotización…"}
        </p>
      )}
    </div>
  );
}
