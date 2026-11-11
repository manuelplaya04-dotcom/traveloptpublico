import type { ReactNode } from "react";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { isDemoProvider, quotedAgo } from "@/lib/format";

// Metadatos secundarios de una tarjeta en un único ⓘ: procedencia del dato ("Dato de ejemplo" o "Cotizado hace X") y lo
// que la tarjeta quiera sumar (comodidades, cómo se contaron los baños…). A la vista quedan el precio y el estado
// principal. Sin nada que decir no se dibuja. Decisión 16 de project_guidelines.md.
export default function CardInfo({ provider, fetchedAt, lines = [], className }: {
  provider: string; fetchedAt?: string | null; lines?: ReactNode[]; className?: string;
}) {
  const ago = isDemoProvider(provider) ? null : quotedAgo(fetchedAt);
  const items = lines.filter(Boolean);
  if (!isDemoProvider(provider) && !ago && items.length === 0) return null;
  return (
    <InfoTooltip className={className}>
      {isDemoProvider(provider) && (
        <span className="block" data-testid="demo-badge">
          <b>Dato de ejemplo.</b> Precio, horario y disponibilidad simulados hasta conectar proveedores reales.
        </span>
      )}
      {ago && (
        <span className="block" data-testid="quote-badge">
          <b><time dateTime={fetchedAt ?? undefined}>{ago}</time>.</b> Precio real del proveedor al consultarlo; confirmalo al reservar.
        </span>
      )}
      {items.map((l, i) => <span key={i} className="mt-1 block first:mt-0">{l}</span>)}
    </InfoTooltip>
  );
}
