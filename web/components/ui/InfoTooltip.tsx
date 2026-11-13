"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

const GAP = 6; // px entre el ícono y la burbuja
const EDGE = 8; // margen mínimo con el borde de la pantalla
const MAX_W = 288;

// Ícono "ⓘ" con una explicación corta. Accesible y sin hover obligatorio:
// - Mouse: aparece al pasar por encima. Teclado: al enfocar. Táctil: se abre y cierra al tocar.
// - Esc o tocar fuera lo cierran. Con scroll o resize acompaña al ícono, y se cierra si el ícono sale de la pantalla.
// - La burbuja va en `position: fixed` y se acomoda dentro de la pantalla: no la recorta un carrusel con scroll ni
//   ensancha la tarjeta (sin overflow). El texto siempre está en el DOM (oculto) para que el lector de pantalla lo lea
//   como descripción del botón aunque no se abra.
// Va FUERA de los <label>: dentro, su nombre se sumaría al nombre accesible del campo. Nombre corto ("Ayuda") y el
// texto como descripción: el lector anuncia "Ayuda, botón" y a continuación la explicación.
export default function InfoTooltip({ children, className = "" }: { children: ReactNode; className?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const byHover = useRef(false); // abierto por pasar el mouse: el clic lo deja fijo en vez de cerrarlo

  const open = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r || typeof window === "undefined") return;
    const width = Math.min(MAX_W, window.innerWidth - EDGE * 2);
    const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, EDGE), window.innerWidth - width - EDGE);
    const below = r.bottom < window.innerHeight * 0.65; // en la parte baja de la pantalla, se abre hacia arriba
    setPos(below ? { left, width, top: r.bottom + GAP } : { left, width, bottom: window.innerHeight - r.top + GAP });
  }, []);
  const close = useCallback(() => { byHover.current = false; setPos(null); }, []);
  const fine = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches;

  const isOpen = pos !== null;
  useEffect(() => {
    if (!isOpen) return;
    // Esc cierra solo la ayuda: preventDefault evita que un <dialog> nativo lo tome como pedido de cierre
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    const onDown = (e: PointerEvent) => { if (!btn.current?.contains(e.target as Node)) close(); };
    // Scroll o resize (incluido el scroll suave que sigue a un cambio de paso): la burbuja acompaña al ícono, una vez
    // por cuadro. Solo se cierra si el ícono salió de la pantalla.
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = btn.current?.getBoundingClientRect();
        if (!r || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) close();
        else open();
      });
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
    };
  }, [isOpen, open, close]);

  // Dentro de un <label> o una tarjeta clicable: no enfoca el campo ni dispara la acción de la tarjeta.
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pos && !byHover.current) close();
    else { byHover.current = false; open(); }
  };

  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button ref={btn} type="button" onClick={onClick} aria-label="Ayuda" aria-describedby={id}
        aria-expanded={!!pos} data-testid="info-tooltip"
        onMouseEnter={() => { if (fine() && !pos) { byHover.current = true; open(); } }}
        onMouseLeave={() => { if (fine() && byHover.current) close(); }}
        // solo el foco de teclado abre (al tocar, el foco llega antes del clic y lo cerraría enseguida)
        onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) open(); }} onBlur={close}
        className="inline-flex size-5 items-center justify-center rounded-full text-xs leading-none text-muted transition-colors duration-300 hover:bg-accent-soft hover:text-accent focus-visible:bg-accent-soft focus-visible:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent print:hidden">
        <span aria-hidden>ⓘ</span>
      </button>
      <span id={id} role="tooltip" hidden={!pos} style={pos ?? undefined} data-testid="info-tooltip-text"
        className="fixed z-50 rounded-xl bg-ink px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-lg [overflow-wrap:anywhere]">
        {children}
      </span>
    </span>
  );
}
