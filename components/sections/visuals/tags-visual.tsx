"use client";

import gsap from "gsap";
import { useEffect, useRef } from "react";

import { useInView, usePrefersReducedMotion } from "@/hooks/use-in-view";
import { cn } from "@/lib/utils";

/**
 * Junta duas ideias que antes eram cards separados: a IA decide o tipo da
 * nota (ideia, tarefa, reunião...) e, no mesmo movimento, sugere as tags.
 * As tags também servem de amostra das 6 matizes da paleta.
 */

const NOTE_TYPES = [
  { label: "ideia", tone: "bg-tag-3 text-tag-3-foreground" },
  { label: "tarefa", tone: "bg-tag-4 text-tag-4-foreground" },
  { label: "reunião", tone: "bg-tag-2 text-tag-2-foreground" },
  { label: "documento", tone: "bg-tag-1 text-tag-1-foreground" },
];

const TAGS = [
  { label: "#pesquisa", tone: "bg-tag-1 text-tag-1-foreground" },
  { label: "#reunião", tone: "bg-tag-2 text-tag-2-foreground" },
  { label: "#ideia", tone: "bg-tag-3 text-tag-3-foreground" },
  { label: "#financeiro", tone: "bg-tag-4 text-tag-4-foreground" },
  { label: "#urgente", tone: "bg-tag-5 text-tag-5-foreground" },
  { label: "#pessoal", tone: "bg-tag-6 text-tag-6-foreground" },
];

export function ClassificationVisual() {
  const { ref: containerRef, inView } = useInView<HTMLDivElement>("120px");
  const reducedMotion = usePrefersReducedMotion();
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ctx = gsap.context(() => {
      // Estado de repouso já é o "depois": tipo decidido (className cuida
      // disso) e tags prontas — sem JS, nada fica pela metade.
      if (reducedMotion) return;

      const tl = gsap.timeline({ repeat: -1, paused: true });
      timelineRef.current = tl;

      tl.set("[data-el^='type-']", { opacity: 0, scale: 0.85 })
        .set("[data-el='tag']", { opacity: 0, scale: 0.4, y: 8 });

      // A IA "pensa" — passa rápido pelos tipos possíveis até decidir.
      NOTE_TYPES.forEach((_, index) => {
        const isLast = index === NOTE_TYPES.length - 1;
        const selector = `[data-el='type-${index}']`;

        tl.to(selector, { opacity: 1, scale: 1, duration: 0.14 });

        if (!isLast) {
          tl.to(selector, { opacity: 0, scale: 0.9, duration: 0.1 }, "+=0.08");
        } else {
          // Decidiu: o tipo final se assenta com um pequeno respiro.
          tl.to(selector, { scale: 1.08, duration: 0.2, ease: "back.out(2)" });
        }
      });

      // Tags brotam junto, uma por matiz.
      tl.to(
        "[data-el='tag']",
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.4,
          stagger: 0.1,
          ease: "back.out(2.2)",
        },
        "+=0.15"
      )
        // O ciclo termina com o card cheio e segura assim. Antes ele
        // desaparecia e esperava 1,2s de mãos vazias — mais de um segundo
        // em branco, no card que carrega a tese inteira do produto. Agora a
        // volta ao começo é o "set" lá de cima, instantâneo, e a próxima
        // classificação já começa no quadro seguinte.
        .to({}, { duration: 2.6 });
    }, container);

    return () => {
      ctx.revert();
      timelineRef.current = null;
    };
  }, [reducedMotion, containerRef]);

  useEffect(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    if (inView) tl.play();
    else tl.pause();
  }, [inView]);

  return (
    <div ref={containerRef} className="flex w-full flex-col items-center gap-3">
      <div className="relative flex h-6 w-24 items-center justify-center">
        {NOTE_TYPES.map(({ label, tone }, index) => (
          <span
            key={label}
            data-el={`type-${index}`}
            className={cn(
              "absolute rounded-lg px-2.5 py-1 text-xs font-semibold",
              // Sem JS, só o tipo final (o que a IA "decidiu") fica visível.
              index === NOTE_TYPES.length - 1 ? "opacity-100" : "opacity-0",
              tone
            )}
          >
            {label}
          </span>
        ))}
      </div>

      <ul className="flex flex-wrap justify-center gap-2">
        {TAGS.map(({ label, tone }) => (
          <li
            key={label}
            data-el="tag"
            className={cn("rounded-full px-3 py-1 text-xs font-semibold", tone)}
          >
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
