import type { ReactNode } from "react";

// Alerta semántica única (DRY): color de acento vibrante + ícono obligatorio + texto, para no depender solo del
// color (WCAG 1.4.1). Íconos de trazo estilo Lucide en línea: sin dependencia ni JS extra.
type Tone = "warning" | "danger" | "info";

const STYLE: Record<Tone, string> = {
  warning: "border-amber-500 bg-amber-50 text-amber-900", // ámbar 900 sobre ámbar 50: 9.6:1
  danger: "border-red-600 bg-red-50 text-red-900",
  info: "border-sky-600 bg-sky-50 text-sky-900",
};
const ICON_COLOR: Record<Tone, string> = { warning: "text-amber-600", danger: "text-red-600", info: "text-sky-600" };
const ICON: Record<Tone, string> = {
  warning: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01",
  danger: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M15 9l-6 6 M9 9l6 6",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01",
};

export function AlertIcon({ tone, className = "size-5" }: { tone: Tone; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" className={`shrink-0 ${className}`}>
      <path d={ICON[tone]} />
    </svg>
  );
}

export default function Alert({ tone, role = tone === "info" ? "status" : "alert", compact, children, ...rest }: {
  tone: Tone; role?: "alert" | "status"; compact?: boolean; children: ReactNode; "data-testid"?: string;
}) {
  return (
    <div role={role} data-testid={rest["data-testid"]}
      className={`flex items-start gap-3 rounded-2xl border-l-4 shadow-sm ${compact ? "px-4 py-2 text-sm" : "p-4"} ${STYLE[tone]}`}>
      <span className={ICON_COLOR[tone]}><AlertIcon tone={tone} className={compact ? "mt-0.5 size-4" : "size-5"} /></span>
      <div className="min-w-0 flex-1 font-medium">{children}</div>
    </div>
  );
}
