import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import CatalogProvider from "@/components/CatalogProvider";
import { ensureCatalog } from "@/lib/catalog";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["600", "800", "900"] });

// Render por request en todas las páginas: Next aplica el nonce de la CSP (proxy.ts) a sus scripts en cada respuesta.
// Una página prerenderizada en el build no tendría nonce y el navegador bloquearía sus scripts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TravelOpt",
  description: "Armamos tu viaje: el itinerario de menor costo que cumple todas tus condiciones.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cities = await ensureCatalog(); // catálogo desde la base (o la copia de respaldo), para servidor y navegador
  return (
    <html lang="es" className={`${inter.variable} ${poppins.variable} h-full antialiased`}>
      <body className="min-h-full"><CatalogProvider cities={cities}>{children}</CatalogProvider></body>
    </html>
  );
}
