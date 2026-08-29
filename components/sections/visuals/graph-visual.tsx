"use client";

import gsap from "gsap";
import { useEffect, useRef } from "react";

import { useInView, usePrefersReducedMotion } from "@/hooks/use-in-view";

const NODES = [
  { x: 130, y: 30, r: 9 },
  { x: 44, y: 70, r: 6 },
  { x: 210, y: 66, r: 6 },
  { x: 80, y: 114, r: 5 },
  { x: 176, y: 118, r: 5 },
  { x: 32, y: 134, r: 4 },
  { x: 228, y: 134, r: 4 },
];

// Arestas percorridas pelos pulsos — refletem a hierarquia parent/child.
const EDGES = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  [3, 4],
  [3, 5],
  [4, 6],
] as const;

export function GraphVisual() {
  const { ref: containerRef, inView } = useInView<HTMLDivElement>("120px");
  const reducedMotion = usePrefersReducedMotion();
  const timelinesRef = useRef<gsap.core.Animation[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ctx = gsap.context(() => {
      if (reducedMotion) return;

      const tl = gsap.timeline({ repeat: -1, paused: true });

      // Um pulso por aresta, saindo do nó de origem para o de destino. O
      // intervalo (0.28s) é menor que a duração (0.85s) de propósito: várias
      // arestas ficam acesas ao mesmo tempo, para parecer uma rede viva em
      // vez de um efeito que dispara uma vez e some.
      EDGES.forEach(([from, to], index) => {
        const origin = NODES[from];
        const target = NODES[to];
        const pulse = `[data-el='pulse-${index}']`;
        const halo = `[data-el='halo-${to}']`;
        const arrival = index * 0.28 + 0.85;

        tl.fromTo(
          pulse,
          { attr: { cx: origin.x, cy: origin.y }, opacity: 0 },
          {
            attr: { cx: target.x, cy: target.y },
            opacity: 1,
            duration: 0.85,
            ease: "power1.inOut",
          },
          index * 0.28
        )
          .to(pulse, { opacity: 0, duration: 0.25 }, arrival)
          // Ping no nó de chegada: um anel que expande e desaparece.
          .fromTo(
            halo,
            { opacity: 0.5, scale: 0.8 },
            { opacity: 0, scale: 2.1, duration: 0.5, ease: "power1.out" },
            arrival
          );
      });

      tl.to({}, { duration: 0.4 });
      timelinesRef.current.push(tl);

      // Respiro contínuo no nó raiz — nunca fica parado entre uma onda de
      // pulsos e outra.
      const breathing = gsap.to("[data-el='halo-0']", {
        opacity: 0.4,
        scale: 1.5,
        duration: 1.6,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        paused: true,
      });
      timelinesRef.current.push(breathing);
    }, container);

    return () => {
      ctx.revert();
      timelinesRef.current = [];
    };
  }, [reducedMotion, containerRef]);

  useEffect(() => {
    for (const tween of timelinesRef.current) {
      if (inView) tween.play();
      else tween.pause();
    }
  }, [inView]);

  return (
    <div ref={containerRef} className="w-full max-w-[260px]">
      <svg aria-hidden viewBox="0 0 260 150" className="h-[150px] w-full">
        <g className="text-border" stroke="currentColor" strokeWidth="1.25">
          {EDGES.map(([from, to]) => (
            <line
              key={`${from}-${to}`}
              x1={NODES[from].x}
              y1={NODES[from].y}
              x2={NODES[to].x}
              y2={NODES[to].y}
            />
          ))}
        </g>

        {NODES.map((node, index) => (
          <circle
            key={`halo-${index}`}
            data-el={`halo-${index}`}
            cx={node.x}
            cy={node.y}
            r={node.r}
            className={
              index === 0
                ? "fill-accent opacity-0"
                : "fill-tag-4-foreground opacity-0"
            }
            style={{ transformOrigin: "center" }}
          />
        ))}

        {NODES.map((node, index) => (
          <circle
            key={`${node.x}-${node.y}`}
            cx={node.x}
            cy={node.y}
            r={node.r}
            className={index === 0 ? "fill-accent" : "fill-subtle-foreground"}
          />
        ))}

        {/* Os pulsos nascem já sobre o nó de origem da sua aresta. Sem cx/cy
            iniciais, o GSAP guarda "" como valor original e o devolve ao
            reverter o contexto — o que o browser rejeita como comprimento
            inválido e reclama no console. */}
        {EDGES.map(([from], index) => (
          <circle
            key={`pulse-${index}`}
            data-el={`pulse-${index}`}
            cx={NODES[from].x}
            cy={NODES[from].y}
            r="3"
            className="fill-tag-4-foreground opacity-0"
          />
        ))}
      </svg>
    </div>
  );
}
