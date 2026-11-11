"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

// Carrusel horizontal de opciones (vuelos, alojamiento, actividades, lugares, eventos): una fila que se desliza con el
// dedo, el mouse o el teclado. Cada tarjeta ocupa ~85% del ancho en el celular (asoma la siguiente: se entiende que se
// puede deslizar), la mitad en tablet y un tercio en escritorio; snap para que cada tarjeta quede alineada.
// Con mouse (pointer: fine) hay flechas laterales y una barra de scroll fina; en pantallas táctiles no hacen falta y se
// ocultan. En papel vuelve a ser una grilla (nada queda cortado).
// La fila no tiene estado: el único estado (si hay más a cada lado) vive en <Arrows>, así que deslizar o elegir una
// tarjeta no redibuja la lista.
export default function Carousel({ label, children, role = "list", testId }: {
  label: string; children: ReactNode; role?: "list" | undefined; testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  return (
    <div className="group/carousel relative">
      <div
        ref={ref}
        id={id}
        role={role}
        aria-label={label}
        tabIndex={0} // axe "scrollable-region-focusable": con teclado se enfoca y se desliza con las flechas
        data-testid={testId}
        className={[
          "-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-4 px-4 pb-3 pt-1 sm:-mx-1 sm:px-1",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          // Mouse: barra fina y discreta, que se marca al pasar por encima (control explícito para escritorio).
          "pointer-fine:[scrollbar-width:thin] pointer-fine:[scrollbar-color:transparent_transparent]",
          "pointer-fine:hover:[scrollbar-color:var(--color-line)_transparent]",
          "pointer-fine:[&::-webkit-scrollbar]:block pointer-fine:[&::-webkit-scrollbar]:h-1.5",
          "pointer-fine:[&::-webkit-scrollbar-thumb]:rounded-full pointer-fine:hover:[&::-webkit-scrollbar-thumb]:bg-line",
          "[&>*]:w-[85%] [&>*]:min-w-[280px] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-[46%] xl:[&>*]:w-[31.5%]",
          "rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent",
          "print:mx-0 print:grid print:grid-cols-2 print:overflow-visible print:px-0 print:[&>*]:w-auto",
        ].join(" ")}
      >
        {children}
      </div>
      <Arrows target={ref} controls={id} label={label} />
    </div>
  );
}

type Edges = { prev: boolean; next: boolean };

// Flechas izquierda/derecha: scroll programático de casi un ancho visible. Se apagan en los extremos. Escucha el
// scroll de la fila (pasivo y agrupado por frame) para saber si hay más de cada lado; nada de esto toca a las tarjetas.
function Arrows({ target, controls, label }: { target: RefObject<HTMLDivElement | null>; controls: string; label: string }) {
  const [edges, setEdges] = useState<Edges>({ prev: false, next: false });

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = { prev: el.scrollLeft > 4, next: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 };
      setEdges((e) => (e.prev === next.prev && e.next === next.next ? e : next));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    el.addEventListener("scroll", schedule, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", schedule);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [target]);

  const move = (dir: -1 | 1) => {
    const el = target.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.85, 280), behavior: reduce ? "auto" : "smooth" });
  };

  if (!edges.prev && !edges.next) return null; // todo entra: sin flechas
  const base = [
    "absolute top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95",
    "text-lg font-bold text-ink shadow-md ring-1 ring-line backdrop-blur pointer-fine:flex print:hidden",
    "transition-all duration-300 hover:scale-105 hover:bg-white hover:shadow-lg",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:pointer-events-none disabled:opacity-0",
  ].join(" ");
  return (
    <>
      <button type="button" aria-controls={controls} aria-label={`Anteriores: ${label}`} disabled={!edges.prev}
        onClick={() => move(-1)} className={`${base} -left-3`} data-testid="carousel-prev">
        <span aria-hidden>‹</span>
      </button>
      <button type="button" aria-controls={controls} aria-label={`Siguientes: ${label}`} disabled={!edges.next}
        onClick={() => move(1)} className={`${base} -right-3`} data-testid="carousel-next">
        <span aria-hidden>›</span>
      </button>
    </>
  );
}
