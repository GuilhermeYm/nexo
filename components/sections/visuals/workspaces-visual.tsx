"use client";

import gsap from "gsap";
import { useEffect, useRef, useState } from "react";

import { useInView, usePrefersReducedMotion } from "@/hooks/use-in-view";
import { cn } from "@/lib/utils";

/**
 * A pilha de workspaces é uma fila de edição: o card da frente tem o nome
 * "digitado" e, terminada a edição, sai de linha e volta para o fim da fila —
 * os outros dois avançam um slot. É a leitura de um baralho: quem foi mexido
 * vai para trás e espera a próxima volta.
 *
 * Posição é transform puro (x/y). Cada workspace é um elemento estável no DOM;
 * quem se move é o card, não o conteúdo trocando de casa.
 */

const WORKSPACES = [
  { name: "Trabalho", tone: "bg-tag-4-foreground" },
  { name: "Estudo", tone: "bg-tag-3-foreground" },
  { name: "Pessoal", tone: "bg-tag-5-foreground" },
] as const;

/**
 * Posição de cada slot da fila, do fundo (0) para a frente (2).
 *
 * O passo vertical (26px) é escolhido contra a altura do card (~38px): o card
 * da frente cobre só a faixa de baixo do que está atrás, e o nome de cada um
 * — centrado a ~19px do topo do próprio card — continua à vista. Com um passo
 * menor que isso a fila vira uma pilha de rótulos cortados pela metade.
 */
const SLOTS = [
  { x: 0, y: 0, z: 0, opacity: 0.55 },
  { x: 14, y: 26, z: 1, opacity: 0.78 },
  { x: 28, y: 52, z: 2, opacity: 1 },
] as const;

/**
 * Fila inicial, do fundo para a frente. "Trabalho" (índice 0) começa na
 * frente, em edição.
 */
const INITIAL_QUEUE = [2, 1, 0];

const TYPE_SPEED = 0.055; // segundos por caractere
const READ_PAUSE = 1.4; // nome inteiro na tela antes de sair de linha
const EXIT = 0.32; // sai da frente pela direita
const RETURN = 0.42; // desce para o fim da fila
const ADVANCE = 0.46; // os que ficam sobem um slot

export function WorkspacesVisual() {
  const { ref: containerRef, inView } = useInView<HTMLDivElement>("120px");
  const reducedMotion = usePrefersReducedMotion();
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Só o nome em digitação precisa de re-render; posição é transform via GSAP.
  const [typing, setTyping] = useState<{ index: number; text: string } | null>(
    null
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ctx = gsap.context(() => {
      // Repouso já é o estado final: fila montada pelo style inline e todos os
      // nomes inteiros. Sem JS ou com "reduzir movimento", nada fica pela metade.
      if (reducedMotion) return;

      // Cópia local da fila. A rotação é determinística e tem período 3, então
      // dá para percorrê-la enquanto a timeline é montada.
      const queue = [...INITIAL_QUEUE];
      const typeState = { chars: 0 };
      const tl = gsap.timeline({ repeat: -1, paused: true });
      timelineRef.current = tl;

      WORKSPACES.forEach((_, cycle) => {
        const editing = queue[2];
        const stepUp = queue[1]; // meio -> frente
        const stepMid = queue[0]; // fundo -> meio
        const name = WORKSPACES[editing].name;
        const label = `edit-${cycle}`;

        // 1. Digita o nome de quem está na frente.
        tl.call(() => {
          setTyping({ index: editing, text: "" });
          typeState.chars = 0;
        })
          .to(typeState, {
            chars: name.length,
            duration: name.length * TYPE_SPEED,
            ease: "none",
            onUpdate: () =>
              setTyping({
                index: editing,
                text: name.slice(0, Math.round(typeState.chars)),
              }),
          })
          // 2. Respiro com o nome inteiro e o cursor ainda piscando.
          .to({}, { duration: READ_PAUSE })
          .call(() => setTyping(null))
          .addLabel(label)
          // 3. Editado, o card sai de linha pela direita...
          .to(cardRefs.current[editing], {
            x: SLOTS[2].x + 46,
            y: SLOTS[2].y - 10,
            scale: 0.94,
            opacity: 0.2,
            duration: EXIT,
            ease: "power2.in",
          })
          // ...e, já fora da vista, assume o fundo da pilha.
          .set(cardRefs.current[editing], { zIndex: SLOTS[0].z })
          .to(cardRefs.current[editing], {
            x: SLOTS[0].x,
            y: SLOTS[0].y,
            scale: 1,
            opacity: SLOTS[0].opacity,
            duration: RETURN,
            ease: "power2.out",
          })
          // 4. Os dois que ficam avançam enquanto o primeiro ainda está saindo:
          //    a fila anda junto, não em dois tempos.
          .set(cardRefs.current[stepUp], { zIndex: SLOTS[2].z }, `${label}+=0.06`)
          .to(
            cardRefs.current[stepUp],
            {
              x: SLOTS[2].x,
              y: SLOTS[2].y,
              opacity: SLOTS[2].opacity,
              duration: ADVANCE,
              ease: "power2.inOut",
            },
            `${label}+=0.06`
          )
          .set(cardRefs.current[stepMid], { zIndex: SLOTS[1].z }, `${label}+=0.06`)
          .to(
            cardRefs.current[stepMid],
            {
              x: SLOTS[1].x,
              y: SLOTS[1].y,
              opacity: SLOTS[1].opacity,
              duration: ADVANCE,
              ease: "power2.inOut",
            },
            `${label}+=0.06`
          );

        // Gira a fila: quem editou volta para o fundo.
        queue.unshift(queue.pop()!);
      });
    }, container);

    return () => {
      ctx.revert();
      timelineRef.current = null;
      setTyping(null);
    };
  }, [reducedMotion, containerRef]);

  useEffect(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    if (inView) tl.play();
    else tl.pause();
  }, [inView]);

  return (
    <div ref={containerRef} className="relative h-[92px] w-full max-w-[220px]">
      {WORKSPACES.map((workspace, index) => {
        // Estado inicial = fila em repouso, escrito no style para o servidor e
        // o primeiro paint baterem antes de o GSAP assumir os transforms.
        const slot = SLOTS[INITIAL_QUEUE.indexOf(index)];
        const isTyping = typing?.index === index;

        return (
          <div
            key={workspace.name}
            ref={(node) => {
              cardRefs.current[index] = node;
            }}
            className="absolute top-0 left-0 flex w-[calc(100%-28px)] items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5"
            style={{
              transform: `translate(${slot.x}px, ${slot.y}px)`,
              opacity: slot.opacity,
              zIndex: slot.z,
            }}
          >
            <span
              className={cn("size-2 shrink-0 rounded-full", workspace.tone)}
            />
            <span className="truncate text-xs text-muted-foreground">
              {isTyping ? typing.text : workspace.name}
              {isTyping && (
                <span className="ml-px inline-block h-3 w-px animate-pulse bg-foreground align-middle motion-reduce:animate-none" />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
