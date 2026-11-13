"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { activeCities, scopeLabel, searchCities, type CityInfo } from "@/lib/cities";

// Buscador de destinos con autocompletado (combobox accesible: ↑ ↓ para moverse, Enter para elegir, Esc para cerrar).
// Busca en el catálogo de ciudades con aeropuerto y coordenadas; si no está, lo dice en vez de inventarla.
export default function CitySearch({ exclude, disabled, onPick, describedBy }: {
  exclude: string[]; disabled: boolean; onPick: (code: string) => void; describedBy?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchCities(query, exclude), [query, exclude]);
  const open = query.trim().length > 0;

  function pick(c: CityInfo) {
    onPick(c.code);
    setQuery("");
    setActive(0);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); pick(results[active]); }
    else if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); } // no cierra el modal
  }

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="sr-only">Buscar destino</label>
      <input
        id={`${id}-input`} type="text" role="combobox" autoComplete="off" disabled={disabled}
        aria-describedby={describedBy} aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${id}-${results[active].code}` : undefined}
        placeholder={disabled ? "Llegaste al máximo de destinos" : "Buscá una ciudad (ej. Nueva York, Orlando, Miami)"}
        value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey}
        className="w-full rounded-xl border border-line bg-white px-4 py-3 text-ink outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent-soft disabled:bg-surface"
      />
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label="Destinos sugeridos"
          className="absolute z-10 mt-2 max-h-72 w-full overflow-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-line">
          {results.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted" role="option" aria-selected={false} aria-disabled>
              Todavía no tenemos “{query.trim()}”. En la beta solo hay ciudades de {scopeLabel(activeCities())}
            </li>
          ) : results.map((c, i) => (
            <li key={c.code} id={`${id}-${c.code}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)} onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm ${
                i === active ? "bg-accent-soft text-accent" : "text-ink"}`}>
              <span><span className="font-semibold">{c.name}</span> <span className="text-muted">· {c.country}</span></span>
              <span className="text-xs text-muted">{c.airports.join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
