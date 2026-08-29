"use client";

import gsap from "gsap";
import { FileText, Mic, Search, StickyNote } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useInView, usePrefersReducedMotion } from "@/hooks/use-in-view";

const QUERY = "energia solar";

const RESULTS = [
  { icon: StickyNote, label: "ideia sobre energia solar", meta: "nota" },
  { icon: Mic, label: "call com fornecedor", meta: "áudio" },
  { icon: FileText, label: "orçamento-paineis.pdf", meta: "arquivo" },
];

export function SearchVisual() {
  const { ref: containerRef, inView } = useInView<HTMLDivElement>("120px");
  const reducedMotion = usePrefersReducedMotion();
  const [typed, setTyped] = useState(QUERY);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ctx = gsap.context(() => {
      if (reducedMotion) return;

      // Objeto intermediário: o GSAP interpola o número de caracteres e o
      // React só recebe o texto já recortado.
      const state = { chars: 0 };

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.6, paused: true });
      timelineRef.current = tl;

      tl.set("[data-el='result']", { opacity: 0, y: 8 })
        .call(() => setTyped(""))
        .to(state, {
          chars: QUERY.length,
          duration: 1.1,
          ease: "none",
          onUpdate: () => setTyped(QUERY.slice(0, Math.round(state.chars))),
        })
        .to("[data-el='result']", {
          opacity: 1,
          y: 0,
          duration: 0.35,
          stagger: 0.1,
          ease: "power2.out",
        })
        .to({}, { duration: 1.8 })
        .to("[data-el='result']", {
          opacity: 0,
          y: 8,
          duration: 0.3,
          stagger: 0.05,
        })
        .set(state, { chars: 0 });
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
    <div ref={containerRef} className="flex w-full flex-col gap-2.5">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <Search className="size-3.5 shrink-0 text-subtle-foreground" />
        <span className="text-xs text-foreground">
          {typed}
          {!reducedMotion && (
            <span className="ml-px inline-block h-3 w-px animate-pulse bg-foreground align-middle" />
          )}
        </span>
        <span className="ml-auto shrink-0 rounded bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-subtle-foreground">
          ⌘K
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {RESULTS.map(({ icon: Icon, label, meta }) => (
          <li
            key={label}
            data-el="result"
            className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-2.5 py-1.5"
          >
            <Icon className="size-3.5 shrink-0 text-tag-4-foreground" />
            <span className="truncate text-xs text-muted-foreground">
              {label}
            </span>
            <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-subtle-foreground">
              {meta}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
