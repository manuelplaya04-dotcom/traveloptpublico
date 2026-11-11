import { ExternalLink } from "lucide-react";

// Marca de "abre en otra pestaña" para los links externos: mismo dibujo en todos los sistemas (el carácter ↗ cambia
// según la fuente y en algunos se ve como emoji).
export default function ExternalIcon() {
  return <ExternalLink aria-hidden className="inline size-3.5 align-[-2px]" />;
}
