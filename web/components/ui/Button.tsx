import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg" | "xl";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-sm hover:bg-accent-hover",
  secondary: "border border-line bg-white text-ink hover:bg-surface",
  ghost: "text-muted hover:bg-surface hover:text-ink",
};
const SIZES: Record<Size, string> = {
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
  xl: "px-10 py-5 text-lg sm:text-xl",
};

export default function Button({ variant = "primary", size = "md", className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
        disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
