import { SynapseMap } from "@/components/sections/visuals/synapse-map";

/**
 * "Como Funciona" — o destino do CTA secundário do hero.
 *
 * Fecha a página com o mecanismo, depois de as funcionalidades terem listado
 * as peças. A seção inverte o terreno do resto da landing (fundo secundário,
 * nós no fundo primário) e troca a densidade do bento por um campo aberto:
 * é o respiro que a seção anterior comprou.
 *
 * O texto descreve o que `lib/ai/classify-document.ts` faz hoje — ler,
 * resumir, decidir o tipo e criar as tags. A escolha automática de workspace
 * aparece no mapa como destino, não como promessa: é a dívida registrada no
 * PRODUCT.md, e a linha de status abaixo do mapa diz isso em voz alta em vez
 * de deixar o visitante descobrir depois de assinar.
 */
export function HowItWorksSection() {
  return (
    <section
      id="como-funciona"
      className="scroll-mt-24 border-t border-border/60 bg-secondary/40 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-6 md:grid-cols-2 md:items-end md:gap-12">
          <h2 className="text-3xl font-bold tracking-[-0.03em] text-balance text-foreground font-[family-name:var(--font-display)] sm:text-4xl md:text-5xl">
            Da bagunça à estrutura, sem você no meio.
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
            Cada coisa que você joga na Nexo passa por um agente. Ele lê o
            arquivo, entende o que é, escreve um resumo, decide o tipo e cria as
            tags — sem você preencher um campo sequer. O mapa é esse caminho:
            do jeito que a captura chegou até o vocabulário pelo qual você vai
            reencontrá-la.
          </p>
        </div>

        <SynapseMap className="mt-14 sm:mt-20" />

        <div className="mx-auto mt-6 flex max-w-xl flex-col items-center gap-3 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Nenhuma das duas portas fecha. Você troca de lado quando quiser, e a
            Nexo se ajusta ao lado em que você estiver.
          </p>
          <p className="inline-flex items-start gap-2 rounded-full border border-dashed border-border px-4 py-2 text-xs leading-relaxed text-subtle-foreground">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-subtle-foreground"
            />
            Hoje o agente classifica e marca; escolher o workspace sozinho é o
            próximo passo — até lá, quem separa por workspace é você.
          </p>
        </div>
      </div>
    </section>
  );
}
