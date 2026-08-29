"use client";

import gsap from "gsap";
import { useEffect, useRef } from "react";

/**
 * Sinapses convergindo — identidade do Nexo em ASCII.
 *
 * É uma grade de caracteres de largura fixa: todas as linhas têm exatamente
 * GRID_COLS colunas, e o nexo (`◈`) fica no centro exato. A geometria importa
 * porque a animação usa a posição de cada célula na grade para propagar o
 * pulso das bordas para o miolo — sem alinhamento, a onda sai torta.
 */
const ASCII_ART = [
  "      ·     ·     ·      ",
  "      \\     │     /      ",
  "·  ─  ◆  ─  ◈  ─  ◆  ─  ·",
  "      /     │     \\      ",
  "      ·     ·     ·      ",
] as const;

/** Espaço rígido: cada célula é um inline-block, e um espaço comum dentro
 *  dele não garante a largura da coluna. */
const CELL_SPACE = "\u00A0";

const GRID_ROWS = ASCII_ART.length;
const GRID_COLS = ASCII_ART[0].length;

const LABEL = "MUDANDO DE MUNDOS";
const SUBLABEL = "conectando suas sinapses…";
const GLYPHS = "!<>-_\\/[]{}=+*^?#";

interface AuthTransitionProps {
  onComplete: () => void;
}

// Transição em tela cheia exibida após login/registro bem-sucedidos: corta
// para preto, acende as sinapses de fora para dentro e resolve o rótulo letra
// a letra antes de navegar. O overlay continua opaco até a rota trocar, sem
// flash de conteúdo.
export function AuthTransition({ onComplete }: AuthTransitionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLParagraphElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onCompleteRef.current();
      return;
    }

    document.documentElement.style.overflow = "hidden";

    const ctx = gsap.context(() => {
      const scramble = { progress: 0 };

      const tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        onComplete: () => onCompleteRef.current(),
      });

      tl.fromTo(
        rootRef.current,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.35 }
      )
        // As células acendem das bordas para o centro: o desenho não aparece
        // pronto, ele se fecha em direção ao nexo.
        .fromTo(
          "[data-cell]",
          { opacity: 0 },
          {
            opacity: 1,
            duration: 0.5,
            stagger: {
              grid: [GRID_ROWS, GRID_COLS],
              from: "edges",
              amount: 0.85,
            },
          },
          "-=0.05"
        )
        .fromTo(
          "[data-sublabel]",
          { opacity: 0 },
          { opacity: 1, duration: 0.4 },
          "-=0.3"
        )
        // O rótulo se resolve da esquerda para a direita a partir de glifos
        // aleatórios, como um terminal decodificando o texto.
        .to(
          scramble,
          {
            progress: 1,
            duration: 1.5,
            ease: "power1.inOut",
            onUpdate: () => {
              const el = labelRef.current;
              if (!el) return;
              const settled = Math.floor(scramble.progress * LABEL.length);
              el.textContent = LABEL.split("")
                .map((char, index) => {
                  if (char === " ") return " ";
                  return index < settled
                    ? char
                    : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
                })
                .join("");
            },
          },
          "-=0.2"
        )
        .fromTo(
          barRef.current,
          { scaleX: 0 },
          { scaleX: 1, duration: 1.5, ease: "power1.inOut" },
          "<"
        )
        .to({}, { duration: 0.35 });

      // Sinal viajando pelas arestas, por baixo da timeline principal: as
      // células longe do centro pulsam antes das de perto, então a luz corre
      // para dentro em vez de a figura inteira piscar junta.
      gsap.to("[data-cell]:not([data-nexus])", {
        opacity: 0.35,
        duration: 0.55,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        stagger: {
          grid: [GRID_ROWS, GRID_COLS],
          from: "edges",
          amount: 0.7,
        },
        delay: 1.7,
      });

      // O nexo respira sozinho — é o único ponto que nunca apaga.
      gsap.to("[data-nexus]", {
        opacity: 0.55,
        scale: 1.25,
        duration: 0.9,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        transformOrigin: "center",
      });
    }, rootRef);

    return () => {
      ctx.revert();
      document.documentElement.style.overflow = "";
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="status"
      aria-label="Mudando de mundos"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#050505] font-mono opacity-0"
    >
      <pre
        aria-hidden="true"
        className="text-center text-sm leading-relaxed text-neutral-400 sm:text-base"
        style={{ textShadow: "0 0 24px rgba(255, 255, 255, 0.25)" }}
      >
        {ASCII_ART.map((line, row) => (
          // A chave é a posição na grade, não o conteúdo: duas linhas da arte
          // são idênticas e usar o texto duplicaria a chave.
          <span key={row} className="block">
            {line.split("").map((char, col) => (
              <span
                key={col}
                data-cell
                data-nexus={char === "◈" ? "" : undefined}
                className={
                  char === "◈"
                    ? "inline-block text-neutral-100"
                    : "inline-block"
                }
              >
                {char === " " ? CELL_SPACE : char}
              </span>
            ))}
          </span>
        ))}
      </pre>

      <p
        ref={labelRef}
        className="mt-8 text-sm tracking-[0.35em] text-neutral-100 sm:text-base"
      >
        {LABEL}
      </p>
      <p data-sublabel className="mt-3 text-xs text-neutral-500">
        {SUBLABEL}
      </p>

      <div className="mt-6 h-px w-40 overflow-hidden bg-neutral-800">
        <div
          ref={barRef}
          className="h-full w-full origin-left scale-x-0 bg-neutral-200"
        />
      </div>
    </div>
  );
}
