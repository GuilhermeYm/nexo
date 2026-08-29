/**
 * Links de checkout do Stripe (Payment Links).
 *
 * Ainda não existem — quando os links forem criados no painel do Stripe, basta
 * preencher as variáveis abaixo em `.env.local`; nenhum componente muda:
 *
 *   NEXT_PUBLIC_STRIPE_CHECKOUT_MONTHLY="https://buy.stripe.com/..."
 *   NEXT_PUBLIC_STRIPE_CHECKOUT_YEARLY="https://buy.stripe.com/..."
 *
 * São Payment Links públicos por natureza (o usuário abre a URL no navegador),
 * por isso podem ser `NEXT_PUBLIC_`. Chaves da API do Stripe, essas nunca.
 */
export type BillingPeriod = "monthly" | "yearly";

const CHECKOUT_LINKS: Record<BillingPeriod, string | undefined> = {
  monthly: process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_MONTHLY,
  yearly: process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_YEARLY,
};

/**
 * Enquanto o link não existe, o CTA leva ao registro: o usuário entra na conta
 * e o checkout acontece depois, dentro do produto. Assim a landing nunca tem
 * um botão que não vai a lugar nenhum.
 */
export function getCheckoutHref(period: BillingPeriod): string {
  return CHECKOUT_LINKS[period] || "/registro";
}

/**
 * Existe checkout de verdade para este período?
 *
 * A seção de planos usa isto para não mentir no rótulo: sem link, o botão
 * promete o que ele realmente faz ("Criar conta e assinar") e explica que o
 * pagamento acontece dentro da Nexo. Com link, volta a ser "Assinar o Pro".
 */
export function hasCheckoutLink(period: BillingPeriod): boolean {
  return Boolean(CHECKOUT_LINKS[period]);
}
