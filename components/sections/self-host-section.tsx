"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight, Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { NEXO_GITHUB_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

/**
 * Aqui morava a tabela de preços.
 *
 * O produto deixou de ter assinatura, e o lugar dela na página não podia ser
 * simplesmente apagado: era ele quem fechava o argumento com um passo
 * seguinte concreto. A pergunta mudou — de "quanto custa" para "como eu ponho
 * isso de pé" —, e esta seção responde a nova com a mesma honestidade que a
 * antiga tinha com a antiga.
 *
 * Os quatro passos são numerados porque a ordem **é** informação: sem projeto
 * no Supabase não há o que preencher no `.env`, e sem `.env` preenchido a
 * migration não tem onde rodar.
 *
 * Todo comando aqui é um comando que existe de verdade no repositório. Um
 * comando inventado numa landing é descoberto no primeiro terminal.
 */

interface Step {
  title: string;
  body: string;
  command?: string;
  /** O que a pessoa precisa ter em mãos antes de conseguir rodar o passo. */
  aside?: string;
}

const STEPS: Step[] = [
  {
    title: "Crie um projeto no Supabase",
    body: "É onde os seus dados vão morar: banco, login e os arquivos. O plano gratuito deles dá conta de uso pessoal com folga.",
    aside: "Anote a URL do projeto, a anon key e a connection string do Postgres.",
  },
  {
    title: "Clone e preencha o .env",
    body: "Três variáveis obrigatórias — as duas do Supabase e a do Postgres. Faltando alguma, a aplicação diz qual é pelo nome em vez de quebrar por dentro.",
    command: "git clone " + NEXO_GITHUB_URL + ".git && cp .env.example .env",
  },
  {
    title: "Aplique as migrations",
    body: "Cria as tabelas, as políticas de Row Level Security e os índices de busca. São idempotentes: rodar de novo não duplica nada.",
    command: "bun install && bun run db:migrate",
  },
  {
    title: "Suba",
    body: "Em desenvolvimento é um comando. Em produção, o build do Next e o servidor que você preferir — a aplicação não exige plataforma nenhuma.",
    command: "bun dev",
  },
];

export function SelfHostSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const ctx = gsap.context(() => {
      if (prefersReducedMotion) return;

      gsap.from("[data-animate='self-host-intro'] > *", {
        opacity: 0,
        y: 24,
        duration: 0.7,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: "[data-animate='self-host-intro']",
          start: "top 80%",
        },
      });

      // O único momento autoral da seção: os passos entram em cascata e cada
      // trecho de régua se desenha logo atrás do seu, de cima para baixo. O
      // movimento diz a mesma coisa que o conteúdo — isto é um caminho, e tem
      // ordem.
      const entrada = gsap.timeline({
        scrollTrigger: { trigger: "[data-animate='steps']", start: "top 78%" },
      });

      entrada
        .from("[data-animate='step']", {
          opacity: 0,
          y: 20,
          duration: 0.6,
          stagger: 0.12,
          ease: "power3.out",
        })
        .from(
          "[data-animate='rail']",
          {
            scaleY: 0,
            transformOrigin: "top center",
            duration: 0.5,
            stagger: 0.12,
            ease: "power2.out",
          },
          0.18
        );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="instalar"
      className="scroll-mt-24 border-t border-border/60 bg-background py-24 sm:py-32"
    >
      <div className="mx-auto grid max-w-6xl gap-14 px-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-20">
        <div data-animate="self-host-intro" className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="text-3xl font-bold tracking-[-0.03em] text-balance text-foreground font-[family-name:var(--font-display)] sm:text-4xl">
            Você sobe. Você manda.
          </h2>

          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Não há assinatura, plano nem teto de uso — não existe uma Nexo
            hospedada para você se cadastrar. O que você paga é a sua própria
            infraestrutura: o projeto Supabase e, se quiser classificação
            automática, a chave de IA que você escolher.
          </p>

          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            <strong className="font-semibold text-foreground">
              Sem nenhuma chave de IA, tudo continua funcionando.
            </strong>{" "}
            Só a classificação vira um classificador simples, local e sem
            custo.
          </p>

          <Button asChild size="lg" className="mt-8 w-full sm:w-auto">
            <a href={NEXO_GITHUB_URL} target="_blank" rel="noopener noreferrer">
              Ver no GitHub
              <ArrowRight className="size-4" />
            </a>
          </Button>

          <p className="mt-4 text-xs leading-relaxed text-subtle-foreground">
            Precisa de um terminal e do{" "}
            <a
              href="https://bun.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
            >
              Bun
            </a>
            . Não precisa de cartão, de conta em lugar nenhum daqui, nem de
            pedir acesso a ninguém.
          </p>
        </div>

        <ol data-animate="steps">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              data-animate="step"
              className="relative pb-10 last:pb-0 sm:pl-14"
            >
              <span
                aria-hidden="true"
                className="mb-3 flex size-8 items-center justify-center rounded-full border border-border bg-secondary text-[13px] font-semibold tabular-nums text-muted-foreground sm:absolute sm:top-0 sm:left-0 sm:mb-0"
              >
                {index + 1}
              </span>

              {/* Um segmento por passo, e nenhum depois do último: uma régua
                  que continua além do quarto número promete um quinto que não
                  existe. Dentro do <li>, ela acompanha a altura real daquele
                  passo sem nenhum cálculo. */}
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  data-animate="rail"
                  className="absolute top-9 bottom-1 left-[15px] hidden w-px bg-border sm:block"
                />
              )}

              <h3 className="text-lg font-bold tracking-[-0.01em] text-foreground font-[family-name:var(--font-display)]">
                {step.title}
              </h3>

              <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
                {step.body}
              </p>

              {step.command && <CommandLine command={step.command} />}

              {step.aside && (
                <p className="mt-3 text-xs leading-relaxed text-subtle-foreground">
                  {step.aside}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * Um comando, copiável.
 *
 * O botão existe porque a alternativa é a pessoa selecionar texto num bloco
 * que quebra em duas linhas no celular e perder metade. Monospace aqui não é
 * fantasia de "técnico": é um comando, e comando se lê caractere a caractere.
 *
 * O estado "copiado" volta sozinho em dois segundos — um rótulo que fica
 * preso em "copiado" mente na segunda vez que a pessoa clica.
 */
function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Sem permissão de área de transferência (http, navegador antigo): o
      // texto continua na tela para ser selecionado à mão.
    }
  }

  return (
    <div className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-secondary/60 py-2.5 pr-2 pl-3.5">
      <code className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-[13px] leading-relaxed whitespace-pre text-foreground">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Comando copiado" : "Copiar o comando"}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
          copied
            ? "text-foreground"
            : "text-subtle-foreground hover:bg-tertiary hover:text-foreground"
        )}
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
