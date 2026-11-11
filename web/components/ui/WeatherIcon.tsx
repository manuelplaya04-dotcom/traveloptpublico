import { CloudRain, CloudSun, Sun, type LucideIcon } from "lucide-react";
import type { WeatherKind } from "@/lib/format";

const ICON: Record<WeatherKind, { Icon: LucideIcon; color: string }> = {
  storm: { Icon: CloudRain, color: "text-sky-700" },
  cloud: { Icon: CloudSun, color: "text-slate-500" },
  sun: { Icon: Sun, color: "text-amber-500" },
};

export default function WeatherIcon({ kind, className = "" }: { kind: WeatherKind; className?: string }) {
  const { Icon, color } = ICON[kind];
  return <Icon aria-hidden className={`size-5 ${color} ${className}`} />;
}
