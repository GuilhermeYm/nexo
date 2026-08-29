"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  FolderTree,
  Inbox,
  Search,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, type ComponentType, type ReactNode } from "react";

import { SynapseWaves } from "@/components/sections/synapse-waves";
import { CaptureVisual } from "@/components/sections/visuals/capture-visual";
import { GraphVisual } from "@/components/sections/visuals/graph-visual";
import { ModesVisual } from "@/components/sections/visuals/modes-visual";
import { SearchVisual } from "@/components/sections/visuals/search-visual";
import { SecurityVisual } from "@/components/sections/visuals/static-visuals";
import { ClassificationVisual } from "@/components/sections/visuals/tags-visual";
import { WorkspacesVisual } from "@/components/sections/visuals/workspaces-visual";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

interface Feature {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  visual: ReactNode;
  /** Colunas ocupadas no bento (grid de 6 colunas em telas grandes). */
  span: string;
  /**
   * O card da tese: ocupa a linha inteira, deita o conteúdo na horizontal e é
   * o único que carrega o acento. Só um por seção — dois acentos não são
   * hierarquia, são decoração.
   */
  hero?: boolean;
}

// A ordem conta a espinha do produto — capturar, separar, classificar,
// reencontrar — e só então a tese (automático + manual) e as garantias. Os
// spans vão de 4/2 a 3/3 e terminam num 6 de propósito: sete retângulos do
// mesmo tamanho não dizem ao olho o que ler primeiro.
const FEATURES: Feature[] = [
  {
    icon: Inbox,
    title: "Capture do jeito que vier",
    description:
      "Texto, áudio, imagem, PDF ou link. Você joga dentro e segue com o seu dia — a Nexo lê, entende e arquiva sozinha.",
    visual: <CaptureVisual />,
    span: "lg:col-span-4",
  },
  {
    icon: FolderTree,
    title: "Workspaces separados",
    description: "Trabalho, estudo e vida pessoal sem se misturarem.",
    visual: <WorkspacesVisual />,
    span: "lg:col-span-2",
  },
  {
    icon: Sparkles,
    title: "Tags e classificação automáticas",
    description:
      "Cada captura vira ideia, tarefa, reunião ou documento — e ganha tags. Sem formulário.",
    visual: <ClassificationVisual />,
    span: "lg:col-span-3",
  },
  {
    icon: Search,
    title: "Busca em milissegundos",
    description:
      "Uma frase incompleta basta. Notas, áudios e arquivos aparecem juntos.",
    visual: <SearchVisual />,
    span: "lg:col-span-3",
  },
  {
    icon: SlidersHorizontal,
    title: "Automático, mas nunca fechado",
    description:
      "A IA organiza por padrão e não para quando você entra: você escreve, move e conecta à mão enquanto ela continua marcando o que chega. Não é um modo que se troca — são as duas coisas ao mesmo tempo.",
    visual: <ModesVisual />,
    span: "lg:col-span-6",
    hero: true,
  },
  {
    icon: Workflow,
    title: "Tudo conectado",
    description:
      "Notas se ligam em hierarquia e referências. A Nexo mostra o que você nem lembrava que tinha escrito.",
    visual: <GraphVisual />,
    span: "lg:col-span-3",
  },
  {
    icon: ShieldCheck,
    title: "Privado por padrão",
    description:
      "Seus dados são isolados por usuário no banco, os arquivos ficam em buckets privados e toda alteração fica registrada.",
    visual: <SecurityVisual />,
    span: "lg:col-span-3",
  },
];

export function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const ctx = gsap.context(() => {
      if (prefersReducedMotion) return;

      gsap.from("[data-animate='feature-header'] > *", {
        opacity: 0,
        y: 24,
        duration: 0.7,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: "[data-animate='feature-header']",
          start: "top 80%",
        },
      });

      gsap.from("[data-animate='feature-card']", {
        opacity: 0,
        y: 32,
        duration: 0.7,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: {
          trigger: "[data-animate='feature-grid']",
          start: "top 75%",
        },
      });

      // Parallax: o fundo de sinapses sobe mais devagar que o conteúdo.
      gsap.to("[data-animate='synapse-bg']", {
        yPercent: 18,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top bottom",
          end: "bottom top",
          scrub: 0.6,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="features"
      className="relative isolate overflow-hidden border-t border-border/60 bg-background py-24 sm:py-32"
    >
      {/* Ondas sinápticas em ASCII. No tema claro o desenho é feito de linhas
          finíssimas sobre papel — a 0,28 de opacidade ele não chegava à tela,
          então o claro recebe mais presença que o escuro. */}
      <div
        data-animate="synapse-bg"
        className="pointer-events-none absolute inset-x-0 -top-[10%] -z-10 h-[120%] opacity-50 dark:opacity-[0.28]"
      >
        <SynapseWaves className="flex h-full w-full items-center justify-center" />
        {/* Dissolve as bordas do desenho para ele não terminar em retângulo. */}
        <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-transparent to-background" />
      </div>

      <div className="mx-auto max-w-6xl px-6">
        <div
          data-animate="feature-header"
          className="mx-auto flex max-w-2xl flex-col items-center text-center"
        >
          <h2 className="text-3xl font-bold tracking-[-0.03em] text-balance text-foreground font-[family-name:var(--font-display)] sm:text-4xl md:text-5xl">
            Organizar deixou de ser tarefa sua
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-balance text-muted-foreground">
            A Nexo faz o trabalho chato de classificar, marcar e conectar. Você
            só precisa capturar.
          </p>
        </div>

        <div
          data-animate="feature-grid"
          className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6"
        >
          {FEATURES.map(
            ({ icon: Icon, title, description, visual, span, hero }) => (
              <article
                key={title}
                data-animate="feature-card"
                className={cn(
                  "group rounded-2xl border border-border p-6 transition-colors duration-300 sm:p-7",
                  hero
                    ? "bg-tertiary sm:col-span-2"
                    : "flex flex-col gap-5 bg-secondary hover:border-subtle-foreground/50",
                  span
                )}
              >
                {hero ? (
                  // O card da tese deita: o argumento fica à esquerda com um
                  // parágrafo inteiro para respirar, e a demonstração ao lado
                  // — não embaixo, espremida.
                  <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-center lg:gap-14">
                    <div>
                      <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                        <Icon className="size-5" />
                      </span>
                      <h3 className="mt-5 text-2xl font-bold tracking-[-0.02em] text-balance text-foreground font-[family-name:var(--font-display)] sm:text-3xl">
                        {title}
                      </h3>
                      <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
                        {description}
                      </p>
                    </div>
                    <div className="flex justify-center lg:justify-end">
                      {visual}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-tertiary text-foreground transition-colors duration-300 group-hover:bg-accent group-hover:text-accent-foreground">
                        <Icon className="size-5" />
                      </span>
                      <h3 className="text-lg font-bold tracking-[-0.01em] text-foreground font-[family-name:var(--font-display)]">
                        {title}
                      </h3>
                    </div>

                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {description}
                    </p>

                    {/* `flex-1` em vez de `mt-auto` + altura mínima: o
                        visual ocupa a sobra da linha e se centraliza nela,
                        em vez de ser empurrado para o fundo do card e
                        deixar um vão no meio. */}
                    <div className="flex flex-1 items-center justify-center pt-3">
                      {visual}
                    </div>
                  </>
                )}
              </article>
            )
          )}
        </div>
      </div>
    </section>
  );
}
