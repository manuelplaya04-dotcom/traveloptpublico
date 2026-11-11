import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import SiteFooter from "@/components/landing/SiteFooter";
import SiteHeader from "@/components/landing/SiteHeader";

// Pantalla 1: landing. Server Component; el único cliente es el CTA con el modal de onboarding.
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <HowItWorks />
      </main>
      <SiteFooter />
    </>
  );
}
