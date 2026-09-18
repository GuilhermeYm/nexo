import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Footer } from "@/components/layout/footer";
import { MobileCtaBar } from "@/components/layout/mobile-cta-bar";
import { Navbar } from "@/components/layout/navbar";
import { FaqSection } from "@/components/sections/faq-section";
import { FeaturesSection } from "@/components/sections/features-section";
import { HeroSection } from "@/components/sections/hero-section";
import { HowItWorksSection } from "@/components/sections/how-it-works-section";
import { SelfHostSection } from "@/components/sections/self-host-section";
import { createClient } from "@/lib/supabase/server";

/**
 * A landing pública — ou o caminho de volta para dentro, para quem já entrou.
 *
 * Quem já tem sessão não precisa ver a página que apresenta o produto que ele
 * já está usando: vai direto para o dashboard.
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
  if (hasSupabaseEnv() && (await hasSessionCookie())) {
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
        <SelfHostSection />
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

/**
 * Dá para subir só a landing, sem Supabase nenhum configurado — nenhuma
 * seção da página lê essas variáveis, exceto este redirecionamento. Sem essa
 * checagem, um cookie perdido de outra instância no mesmo domínio faria
 * `createClient()` lançar `missingEnvError` e devolver 500 numa página que,
 * de outro modo, não precisaria de banco nenhum para existir.
 */
function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
