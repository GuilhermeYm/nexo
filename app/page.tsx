import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Footer } from "@/components/layout/footer";
import { MobileCtaBar } from "@/components/layout/mobile-cta-bar";
import { Navbar } from "@/components/layout/navbar";
import { FaqSection } from "@/components/sections/faq-section";
import { FeaturesSection } from "@/components/sections/features-section";
import { HeroSection } from "@/components/sections/hero-section";
import { HowItWorksSection } from "@/components/sections/how-it-works-section";
import { PricingSection } from "@/components/sections/pricing-section";
import { createClient } from "@/lib/supabase/server";

/**
 * A landing pública — ou o caminho de volta para dentro, para quem já entrou.
 *
 * Quem já tem sessão não precisa ver a página que vende o produto que ele já
 * assinou: vai direto para o dashboard.
 *
 * A checagem é feita em duas etapas de propósito. `getUser()` valida o JWT no
 * servidor do Supabase, o que é uma ida à rede — e cobrá-la de **todo**
 * visitante anônimo atrasaria a página mais visitada do site para quem ela
 * foi feita. Então primeiro olhamos se existe cookie de sessão: sem ele, não
 * há nada a validar e a landing renderiza sem custo nenhum. Com ele, aí sim
 * a validação acontece, e um cookie velho simplesmente não redireciona
 * ninguém — a pessoa vê a landing, que é o comportamento certo.
 */
export default async function Home() {
  if (await hasSessionCookie()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) redirect("/dashboard");
  }

  return (
    <>
      <Navbar />
      <main>
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
        <PricingSection />
        <FaqSection />
      </main>
      <Footer />
      <MobileCtaBar />
    </>
  );
}

/**
 * Existe cookie de sessão do Supabase?
 *
 * Só uma triagem barata — o cookie pode estar expirado, e quem decide isso é
 * o `getUser()`. Nunca use isto como autorização.
 */
async function hasSessionCookie(): Promise<boolean> {
  const store = await cookies();

  return store
    .getAll()
    .some(
      (cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token")
    );
}
