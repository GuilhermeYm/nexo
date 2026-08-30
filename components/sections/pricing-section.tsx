"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Check, ChevronDown, Clock } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { type BillingPeriod } from "@/lib/stripe";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

interface Plan {
  name: string;
  tagline: string;
  /** Preço já formatado — string fixa, para não depender do locale do runtime. */
  price: Record<BillingPeriod, string>;
  /** Linha logo abaixo do preço: o que está sendo cobrado, e quando. */
  billingNote: Record<BillingPeriod, string>;
  /**
   * As linhas dos dois planos estão na mesma ordem e com a mesma redação de
   * propósito: capturas, IA, workspaces, busca, armazenamento, suporte. Assim
   * a comparação é feita com o olho, linha por linha, e não com a memória.
   */
  features: string[];
  /** O que o plano ainda não entrega. Nunca misturar com a lista de cima. */
  upcoming?: string[];
  /** Fecha o card mais curto com algo verdadeiro em vez de espaço vazio. */
  closingNote?: string;
  featured?: boolean;
}

// Os números abaixo (preços, limites de captura e de armazenamento) são a
// proposta inicial — troque à vontade, mas mantenha-os de acordo com
// `lib/plans.ts`, que é quem as rotas consultam para barrar de verdade.
//
// **O Pro é o Gratuito sem os tetos.** Nenhuma linha da lista de baixo existe
// só para quem paga: as sete linhas são as mesmas nos dois cartões, na mesma
// ordem e com a mesma redação, e só os números mudam. Isso é de propósito —
// a comparação é feita com o olho, linha por linha, e não com a memória.
const PLANS: Plan[] = [
  {
    name: "Gratuito",
    tagline: "A Nexo inteira, com teto. Para conhecer sem compromisso.",
    price: { monthly: "R$ 0", yearly: "R$ 0" },
    billingNote: { monthly: "para sempre", yearly: "para sempre" },
    features: [
      "50 capturas por mês — notas e arquivos",
      "Envio de PDF, texto e áudio",
      "Classificação, resumo e tags por IA",
      "1 workspace",
      "Busca por texto",
      "200 MB de arquivos",
      "Suporte por e-mail",
    ],
    closingNote:
      "Sem cartão de crédito. Ao bater no teto nada some: a Nexo avisa, e tudo o que você já guardou continua lá. Você só decide sobre o Pro depois que ela já tiver virado o lugar onde tudo cai.",
  },
  {
    name: "Pro",
    tagline: "Tudo do Gratuito, sem os tetos — para quem joga tudo na Nexo.",
    // Preço provisório: R$ 50/mês enquanto finalizamos a integração com o
    // Stripe. O anual mantém o desconto de dois meses grátis.
    price: { monthly: "R$ 50", yearly: "R$ 42" },
    billingNote: {
      monthly: "por mês, cobrado mensalmente",
      yearly: "por mês, cobrado R$ 504 por ano",
    },
    features: [
      "Capturas ilimitadas — notas e arquivos",
      "Envio de PDF, texto e áudio",
      "Classificação, resumo e tags por IA",
      "Workspaces ilimitados",
      "Busca por texto",
      "20 GB de arquivos",
      "Suporte prioritário",
    ],
    // Nada aqui roda hoje. Continua no cartão porque é o que o Pro vai ser,
    // fica **separado** da lista de cima porque cobrar por uma funcionalidade
    // que não existe volta como estorno — não como reclamação —, e vem
    // **recolhido** porque, aberto, o bloco estica o cartão do Pro e abre um
    // buraco no do Gratuito ao lado.
    //
    // O modelo mais capacitado entra nesta lista pelo mesmo motivo: hoje a
    // classificação de todo mundo passa pelos modelos rápidos da Groq, e
    // anunciá-lo entre as linhas de cima seria vender o que ainda não roda.
    upcoming: [
      "Processamento com modelos de IA mais capacitados",
      "Tarefas de IA que agem sobre os seus arquivos e documentos",
      "Busca semântica em notas, áudios e PDFs",
      "Ambiente de blocos, hierarquia e links",
    ],
    featured: true,
  },
];

const PERIOD_OPTIONS: { value: BillingPeriod; label: string }[] = [
  { value: "monthly", label: "Mensal" },
  { value: "yearly", label: "Anual" },
];

/**
 * "Planos" — a seção que fecha o argumento antes do FAQ.
 *
 * Dois planos e um seletor de período: quem chega aqui já sabe o que a Nexo
 * faz e só precisa saber quanto custa. O CTA do Pro está desabilitado
 * enquanto finalizamos a integração com o Stripe.
 */
export function PricingSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [period, setPeriod] = useState<BillingPeriod>("yearly");

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const ctx = gsap.context(() => {
      if (prefersReducedMotion) return;

      gsap.from("[data-animate='pricing-header'] > *", {
        opacity: 0,
        y: 24,
        duration: 0.7,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: "[data-animate='pricing-header']",
          start: "top 80%",
        },
      });

      gsap.from("[data-animate='plan-card']", {
        opacity: 0,
        y: 32,
        duration: 0.7,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: {
          trigger: "[data-animate='plan-grid']",
          start: "top 78%",
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="planos"
      className="scroll-mt-24 border-t border-border/60 bg-background py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div
          data-animate="pricing-header"
          className="mx-auto flex max-w-2xl flex-col items-center text-center"
        >
          <h2 className="text-3xl font-bold tracking-[-0.03em] text-balance text-foreground font-[family-name:var(--font-display)] sm:text-4xl md:text-5xl">
            Um preço, nenhuma surpresa
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-balance text-muted-foreground">
            Comece de graça e assine quando a Nexo já tiver virado o lugar onde
            tudo cai. Cancele quando quiser, sem multa.
          </p>

          {/* Seletor de período. Dois botões de alternância com `aria-pressed`
              em vez de um radiogroup: assim cada um continua alcançável por
              Tab, sem precisar do roving tabindex que o padrão de rádio exige. */}
          <div
            role="group"
            aria-label="Período de cobrança"
            className="mt-9 inline-flex items-center gap-1 rounded-full border border-border bg-secondary p-1"
          >
            {PERIOD_OPTIONS.map((option) => {
              const isActive = period === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setPeriod(option.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors duration-200",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                  {option.value === "yearly" && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-bold",
                        isActive
                          ? "bg-accent-foreground/15 text-accent-foreground"
                          : "bg-tag-3 text-tag-3-foreground"
                      )}
                    >
                      −20%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div
          data-animate="plan-grid"
          className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-5 md:grid-cols-2"
        >
          {PLANS.map((plan) => (
            <article
              key={plan.name}
              data-animate="plan-card"
              className={cn(
                "relative flex h-full flex-col rounded-3xl border p-8 transition-colors duration-300",
                plan.featured
                  ? "border-accent/70 bg-secondary shadow-xl shadow-black/[0.06]"
                  : "border-border bg-secondary/60 hover:border-subtle-foreground/50"
              )}
            >
              {plan.featured && (
                // "Recomendado" e não "Mais escolhido": o segundo é uma
                // estatística, e com zero assinantes seria publicidade
                // enganosa. Este é opinião do fabricante — e é legítima.
                <span className="absolute -top-3 left-8 rounded-full bg-accent px-3 py-1 text-[11px] font-bold tracking-wide text-accent-foreground uppercase">
                  Recomendado
                </span>
              )}

              <h3 className="text-xl font-bold text-foreground font-[family-name:var(--font-display)]">
                {plan.name}
              </h3>
              {/* Altura reservada para duas linhas: sem isso o preço do Pro
                  desce em relação ao do Gratuito e a comparação linha a linha
                  perde o eixo. */}
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:min-h-[2.75rem]">
                {plan.tagline}
              </p>

              <p className="mt-7 text-4xl font-bold tracking-[-0.03em] text-foreground font-[family-name:var(--font-display)] sm:text-5xl">
                {plan.price[period]}
              </p>
              <p className="mt-1.5 text-sm text-subtle-foreground">
                {plan.billingNote[period]}
              </p>

              <ul className="mt-8 flex flex-col gap-3.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        plan.featured
                          ? "text-foreground"
                          : "text-subtle-foreground"
                      )}
                    />
                    <span className="text-sm leading-relaxed text-muted-foreground">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              {plan.upcoming && (
                <UpcomingDisclosure
                  planName={plan.name}
                  items={plan.upcoming}
                />
              )}

              {plan.closingNote && (
                <p className="mt-7 border-t border-border/70 pt-6 text-sm leading-relaxed text-muted-foreground">
                  {plan.closingNote}
                </p>
              )}

              {/* O `mt-auto` vive aqui, e não na nota de fechamento.
                  Os dois cartões têm a mesma altura (grid) e conteúdos de
                  tamanhos diferentes — com o "Em breve" recolhido, o Gratuito
                  costuma ser o mais alto pela nota de fechamento. A sobra do
                  cartão mais curto tem que cair em algum lugar: empurrando a
                  nota para o rodapé ela caía num buraco no meio; empurrando o
                  botão, a sobra vira respiro antes do CTA e os dois botões
                  ficam alinhados na mesma linha. */}
              <div className="mt-auto pt-8">
                <Button
                  size="lg"
                  variant={plan.featured ? "default" : "outline"}
                  className="w-full"
                  disabled={plan.featured}
                >
                  {plan.featured
                    ? "Disponível em breve"
                    : "Começar agora"}
                </Button>

                {plan.featured && (
                  <p className="mt-3 text-center text-xs leading-relaxed text-subtle-foreground">
                    O pagamento será liberado assim que finalizarmos a
                    integração.
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-subtle-foreground">
          Pagamento seguro via Stripe. Cartão de crédito e Pix.
        </p>
      </div>
    </section>
  );
}

/**
 * "Em breve no {plano}" — `<details>` nativo, recolhido por padrão.
 *
 * Nativo porque não vale um estado nem uma dependência para uma revelação:
 * teclado, `aria-expanded` e o alvo de foco vêm de graça. O que ele **não**
 * dá é a animação de altura, então ela é feita à mão com o GSAP que a seção
 * já carrega:
 *
 * - **Abrir:** o `<details>` já mostrou o conteúdo quando `onToggle` dispara;
 *   o tween parte de altura 0 e sobe até a altura natural.
 * - **Fechar:** o clique no `summary` é interceptado (`preventDefault`) para
 *   o conteúdo não sumir de imediato; anima até 0 e só então marca
 *   `open = false`.
 *
 * `prefers-reduced-motion` pula os dois tweens — o `<details>` alterna seco.
 * Depois de cada transição, `ScrollTrigger.refresh()` recalcula os gatilhos
 * das seções abaixo contra a nova altura do documento.
 */
function UpcomingDisclosure({
  planName,
  items,
}: {
  planName: string;
  items: string[];
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Sem padding próprio: `height: 0` só é de fato zero se a caixa não
  // reservar espaço de padding. O respiro mora no filho.
  const contentRef = useRef<HTMLDivElement>(null);

  function prefersReducedMotion() {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function handleToggle() {
    const details = detailsRef.current;
    const content = contentRef.current;
    if (!details || !content) return;

    if (!details.open || prefersReducedMotion()) {
      ScrollTrigger.refresh();
      return;
    }

    gsap.fromTo(
      content,
      { height: 0, opacity: 0 },
      {
        height: "auto",
        opacity: 1,
        duration: 0.36,
        ease: "power2.out",
        onComplete: () => {
          gsap.set(content, { clearProps: "height,opacity" });
          ScrollTrigger.refresh();
        },
      }
    );
  }

  function handleSummaryClick(event: ReactMouseEvent<HTMLElement>) {
    const details = detailsRef.current;
    const content = contentRef.current;
    // Só o fechamento precisa ser segurado; abrir segue pelo caminho nativo.
    if (!details || !content || !details.open || prefersReducedMotion()) return;

    event.preventDefault();
    gsap.to(content, {
      height: 0,
      opacity: 0,
      duration: 0.26,
      ease: "power2.in",
      onComplete: () => {
        details.open = false;
        gsap.set(content, { clearProps: "height,opacity" });
        ScrollTrigger.refresh();
      },
    });
  }

  return (
    <details
      ref={detailsRef}
      onToggle={handleToggle}
      className="group mt-7 rounded-2xl border border-dashed border-border bg-background/50 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary
        onClick={handleSummaryClick}
        className="flex cursor-pointer list-none items-center gap-2 rounded-2xl p-4 outline-none transition-colors duration-200 hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-subtle-foreground"
      >
        <span className="text-[11px] font-bold tracking-wide text-subtle-foreground uppercase">
          Em breve no {planName}
        </span>
        <span className="rounded-full bg-tertiary px-1.5 py-0.5 text-[10px] font-bold text-subtle-foreground tabular-nums">
          {items.length}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="ml-auto size-4 text-subtle-foreground transition-transform duration-300 ease-out group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div ref={contentRef} className="overflow-hidden">
        <div className="px-4 pb-4">
          <ul className="flex flex-col gap-2.5">
            {items.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <Clock
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
                />
                <span className="text-sm leading-relaxed text-subtle-foreground">
                  {feature}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-subtle-foreground">
            Ainda não estão no ar. Entram para quem já é assinante, sem custo
            adicional.
          </p>
        </div>
      </div>
    </details>
  );
}
