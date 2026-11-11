import Link from "next/link";

export default function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
      <Link href="/" className="font-display text-xl font-black tracking-tight text-ink">
        Travel<span className="text-accent">Opt</span>
      </Link>
      <nav className="hidden gap-6 text-sm font-medium text-muted sm:flex">
        <Link href="/#que-buscamos" className="hover:text-ink">Qué buscamos</Link>
        <Link href="/#quienes-somos" className="hover:text-ink">Quiénes somos</Link>
      </nav>
    </header>
  );
}
