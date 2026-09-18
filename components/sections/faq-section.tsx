"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { useEffect, useRef } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

gsap.registerPlugin(ScrollTrigger);

interface FaqItem {
  question: string;
  /**
   * Deixe vazio enquanto a resposta não estiver escrita: o acordeão mostra um
   * aviso discreto no lugar, em vez de abrir e não dizer nada.
   */
  answer: string;
}

/*
 * Quatro perguntas, quatro respostas.
 *
 * A lista tinha dez, todas em branco — e esta é a última coisa que o visitante
 * lê antes de decidir. Levantar a objeção e não resolvê-la é pior do que não
 * levantá-la, então ficaram só as que dá para responder com verdade hoje.
 *
 * As outras quatro voltam quando tiverem resposta. Ficam registradas aqui para
 * não se perderem:
 *
 *   - "Como a IA decide o tipo, as tags e o workspace de cada captura?"
 *     (só volta quando o classificador escolher workspace de verdade —
 *      ver a dívida registrada no PRODUCT.md)
 *   - "E se ela classificar errado? Consigo corrigir?"
 *   - "Meus dados são usados para treinar modelos de IA?"
 *   - "Dá para exportar tudo e levar embora?"
 */
const FAQ_ITEMS: FaqItem[] = [
  {
    question: "O que exatamente eu posso jogar dentro da Nexo?",
    answer:
      "Texto digitado, PDF, .txt, .md, .docx, áudio (mp3, wav, m4a), imagem e link. Você não precisa dizer o que é nem escolher onde vai: a Nexo lê o que dá para ler, escreve um resumo, decide se aquilo é uma nota, uma tarefa, uma ideia, um documento, um registro de diário ou uma reunião, e cria de uma a cinco tags. Cada arquivo pode ter até 25 MB.",
  },
  {
    question: "Quem consegue ver o que eu guardo na Nexo?",
    answer:
      "Só você. Não é uma promessa no rodapé — é como o banco está montado. Todas as tabelas têm Row Level Security ligada, e cada consulta é filtrada pelo seu usuário no próprio banco de dados, não na aplicação: mesmo uma falha no código não devolveria a nota de outra pessoa. Os arquivos ficam em buckets privados, acessíveis só por links temporários assinados para você. E toda alteração em dado sensível fica registrada numa trilha de auditoria.",
  },
  {
    question: "Quanto custa?",
    answer:
      "Nada é cobrado por nós: não há assinatura, plano nem teto de uso. O que você paga é o que a sua própria infraestrutura custar — o projeto Supabase (o plano gratuito dá conta de uso pessoal) e, se quiser classificação por IA, a chave do provedor que escolher. Sem chave de IA nenhuma tudo continua funcionando; só a classificação automática vira um classificador simples, sem custo.",
  },
  {
    question: "Preciso saber programar para subir isso?",
    answer:
      "Precisa se virar com um terminal, sim. São quatro passos — criar um projeto no Supabase, preencher um arquivo de variáveis, rodar as migrations e subir a aplicação —, e o repositório documenta cada um. Não é um clique, mas também não é um fim de semana.",
  },
  {
    question: "Tem aplicativo para celular?",
    answer:
      "Ainda não. Hoje a Nexo é web e funciona no navegador do celular. Ter presença fora do navegador é um compromisso assumido, mas sem data marcada — e a gente prefere dizer isso a inventar um trimestre.",
  },
];

/**
 * "Perguntas frequentes" — a última objeção antes do rodapé.
 *
 * Coluna única e estreita: uma pergunta por linha lê mais rápido que duas
 * colunas, e o acordeão do Radix cuida do teclado e do estado anunciado. O
 * `type="single"` com `collapsible` mantém uma resposta aberta por vez, para a
 * lista não virar um paredão de texto.
 */
export function FaqSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const ctx = gsap.context(() => {
      if (prefersReducedMotion) return;

      gsap.from("[data-animate='faq-header'] > *", {
        opacity: 0,
        y: 24,
        duration: 0.7,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: "[data-animate='faq-header']",
          start: "top 80%",
        },
      });

      gsap.from("[data-animate='faq-list']", {
        opacity: 0,
        y: 28,
        duration: 0.7,
        ease: "power3.out",
        scrollTrigger: {
          trigger: "[data-animate='faq-list']",
          start: "top 82%",
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="faq"
      className="scroll-mt-24 border-t border-border/60 bg-secondary/40 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-3xl px-6">
        <div
          data-animate="faq-header"
          className="flex flex-col items-center text-center"
        >
          <h2 className="text-3xl font-bold tracking-[-0.03em] text-balance text-foreground font-[family-name:var(--font-display)] sm:text-4xl md:text-5xl">
            Perguntas frequentes
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-balance text-muted-foreground">
            O que costuma vir antes de criar a conta — respondido sem rodeio.
          </p>
        </div>

        <Accordion
          type="single"
          collapsible
          data-animate="faq-list"
          className="mt-14 rounded-3xl border border-border bg-background/60 px-6 sm:px-8"
        >
          {FAQ_ITEMS.map((item, index) => (
            <AccordionItem key={item.question} value={`item-${index}`}>
              <AccordionTrigger>{item.question}</AccordionTrigger>
              <AccordionContent>
                {item.answer || (
                  <span className="text-subtle-foreground italic">
                    Resposta em preparação.
                  </span>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <p className="mt-10 text-center text-sm leading-relaxed text-muted-foreground">
          Ficou uma pergunta de fora?{" "}
          <Link
            href="mailto:contato@nexo.app"
            className="font-semibold text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
          >
            Escreva para a gente
          </Link>{" "}
          — respondemos em até um dia útil.
        </p>
      </div>
    </section>
  );
}
