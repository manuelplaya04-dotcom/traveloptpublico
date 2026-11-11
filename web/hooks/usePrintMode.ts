"use client";

import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

// Modo impresión: true mientras el navegador imprime o genera el PDF (Ctrl+P o el botón). El contenido que solo se
// necesita en papel se monta recién entonces; flushSync asegura que esté en el DOM antes de que se tome la impresión.
export function usePrintMode() {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  /** Botón "Imprimir / PDF": monta la versión de papel, espera un cuadro para que se pinte e imprime. */
  const print = useCallback(() => {
    flushSync(() => setPrinting(true));
    requestAnimationFrame(() => window.print());
  }, []);

  return { printing, print };
}
