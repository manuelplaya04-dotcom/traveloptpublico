"use client";

import { Link2 } from "lucide-react";
import { useState } from "react";
import Button from "@/components/ui/Button";

// Crea (o recupera) el link de solo lectura del itinerario y lo copia al portapapeles para mandarlo al grupo.
export default function ShareButton({ runId }: { runId: string }) {
  const [state, setState] = useState<{ url?: string; error?: boolean; copied?: boolean }>({});
  const share = async () => {
    setState({});
    try {
      const r = await fetch("/api/share", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }),
      });
      const d = (await r.json()) as { url?: string };
      if (!r.ok || !d.url) throw new Error("share_failed");
      const copied = await (navigator.clipboard?.writeText(d.url).then(() => true, () => false) ?? false);
      setState({ url: d.url, copied });
    } catch {
      setState({ error: true });
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" onClick={share} data-testid="share"><Link2 aria-hidden className="mr-1.5 inline size-4 align-text-bottom" />Compartir</Button>
      {state.url && (
        <p role="status" className="max-w-xs text-right text-xs text-muted" data-testid="share-url">
          {state.copied ? "Link copiado. " : ""}Solo lectura, vence en 30 días:{" "}
          <a href={state.url} className="break-all font-medium text-accent hover:underline">{state.url}</a>
        </p>
      )}
      {state.error && <p role="alert" className="text-xs text-red-700">No pudimos crear el link. Probá de nuevo.</p>}
    </div>
  );
}
