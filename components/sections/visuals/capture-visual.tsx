"use client";

import gsap from "gsap";
import { FileText, MousePointer2, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

import { useInView, usePrefersReducedMotion } from "@/hooks/use-in-view";

/**
 * O hook do produto: o usuário só joga o arquivo dentro; a IA classifica.
 * A animação encena exatamente isso — cursor arrasta um arquivo para a área
 * de captura, a IA "pensa" e as tags aparecem sozinhas.
 */

const SUGGESTED_TAGS = [
  { label: "#documento", tone: "bg-tag-1 text-tag-1-foreground" },
  { label: "#financeiro", tone: "bg-tag-4 text-tag-4-foreground" },
  { label: "#urgente", tone: "bg-tag-5 text-tag-5-foreground" },
];

export function CaptureVisual() {
  const { ref: containerRef, inView } = useInView<HTMLDivElement>("120px");
  const reducedMotion = usePrefersReducedMotion();
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ctx = gsap.context(() => {
      // Estado de repouso já é o "depois": arquivo capturado e tags prontas.
      if (reducedMotion) return;

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4, paused: true });
      timelineRef.current = tl;

      tl.set("[data-el='cursor']", { x: 150, y: 96, opacity: 0 })
        .set("[data-el='file']", { x: 0, y: 0, scale: 1, opacity: 1 })
        .set("[data-el='dropzone']", { borderColor: "var(--nx-border)" })
        .set("[data-el='scan']", { scaleX: 0, opacity: 0 })
        .set("[data-el='thinking']", { opacity: 0 })
        .set("[data-el='tag']", { opacity: 0, scale: 0.6, y: 6 })

        // Cursor entra e vai até o arquivo.
        .to("[data-el='cursor']", { opacity: 1, duration: 0.25 })
        .to("[data-el='cursor']", {
          x: 28,
          y: 18,
          duration: 0.7,
          ease: "power2.inOut",
        })
        // Pega o arquivo.
        .to("[data-el='file']", { scale: 1.06, duration: 0.15 })
        // Arrasta os dois juntos para a área de captura.
        .to(
          "[data-el='cursor']",
          { x: 96, y: 104, duration: 0.85, ease: "power2.inOut" },
          "drag"
        )
        .to(
          "[data-el='file']",
          { x: 68, y: 86, duration: 0.85, ease: "power2.inOut" },
          "drag"
        )
        .to(
          "[data-el='dropzone']",
          { borderColor: "var(--nx-tag-4-text)", duration: 0.3 },
          "drag+=0.45"
        )
        // Solta.
        .to("[data-el='file']", {
          scale: 0.9,
          opacity: 0,
          duration: 0.25,
          ease: "power2.in",
        })
        .to("[data-el='cursor']", { opacity: 0, duration: 0.2 }, "<")
        .to("[data-el='dropzone']", {
          borderColor: "var(--nx-border)",
          duration: 0.3,
        })

        // A IA analisa: barra varrendo + rótulo pulsando.
        .to("[data-el='thinking']", { opacity: 1, duration: 0.25 })
        .fromTo(
          "[data-el='scan']",
          { scaleX: 0, opacity: 1, transformOrigin: "left center" },
          { scaleX: 1, duration: 0.9, ease: "power1.inOut" }
        )
        .to("[data-el='scan']", { opacity: 0, duration: 0.2 })
        .to("[data-el='thinking']", { opacity: 0, duration: 0.2 }, "<")

        // Tags brotam uma a uma.
        .to("[data-el='tag']", {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.4,
          stagger: 0.14,
          ease: "back.out(2)",
        })
        .to({}, { duration: 1.5 })
        // Volta ao início sem corte seco.
        .to("[data-el='tag']", { opacity: 0, duration: 0.35, stagger: 0.06 });
    }, container);

    return () => {
      ctx.revert();
      timelineRef.current = null;
    };
  }, [reducedMotion, containerRef]);

  // Só gasta CPU enquanto o card está na tela.
  useEffect(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    if (inView) tl.play();
    else tl.pause();
  }, [inView]);

  return (
    <div ref={containerRef} className="relative h-[210px] w-full max-w-[300px]">
      {/* Arquivo que será arrastado */}
      <div
        data-el="file"
        className="absolute left-0 top-0 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-sm"
      >
        <FileText className="size-4 text-tag-5-foreground" />
        <span className="text-xs font-medium text-foreground">contrato.pdf</span>
      </div>

      {/* Área de captura */}
      <div
        data-el="dropzone"
        className="absolute inset-x-0 top-[78px] flex h-[62px] items-center justify-center rounded-xl border-2 border-dashed border-border bg-secondary/60"
      >
        <span className="text-xs text-subtle-foreground">
          solte aqui — a Nexo cuida do resto
        </span>
        {/* Barra de varredura da IA */}
        <div
          data-el="scan"
          className="absolute inset-x-3 bottom-2 h-0.5 origin-left rounded-full bg-tag-4-foreground opacity-0"
        />
      </div>

      {/* Rótulo de processamento */}
      <div
        data-el="thinking"
        className="absolute inset-x-0 top-[148px] flex items-center justify-center gap-1.5 opacity-0"
      >
        <Sparkles className="size-3.5 text-tag-4-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          classificando…
        </span>
      </div>

      {/* Tags sugeridas pela IA */}
      <ul className="absolute inset-x-0 top-[172px] flex flex-wrap justify-center gap-2">
        {SUGGESTED_TAGS.map(({ label, tone }) => (
          <li
            key={label}
            data-el="tag"
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
          >
            {label}
          </li>
        ))}
      </ul>

      {/* Cursor */}
      <MousePointer2
        data-el="cursor"
        className="pointer-events-none absolute left-0 top-0 size-5 fill-foreground text-background opacity-0"
      />
    </div>
  );
}
