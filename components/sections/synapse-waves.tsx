"use client";

import { useEffect, useRef } from "react";

import { useInView, usePrefersReducedMotion } from "@/hooks/use-in-view";

/**
 * Ondas sinápticas em ASCII.
 *
 * Adaptado de `ondas_sinapticas_landing.html`. O original reconstruía ~2100
 * <span> via innerHTML a cada frame; aqui o mesmo desenho vai para um <canvas>
 * com fonte monoespaçada, o que mantém a estética ASCII sem repintar o DOM.
 */

const COLS = 62;
const ROWS = 34;
const DASH_CHARS = ["-", "·", " ", ",", "·", " "];

interface Layer {
  amplitude: number;
  frequency: number;
  phase: number;
  yOffset: number;
  speed: number;
  /** 0 = camada de trás (mais apagada), 1 = camada da frente. */
  depth: number;
  /** Índice na paleta de tags usado pelos pontos viajantes. */
  tagIndex: number;
}

const LAYERS: Layer[] = [
  { amplitude: 2.0, frequency: 0.1, phase: 0.0, yOffset: 5.0, speed: 0.025, depth: 0.0, tagIndex: 0 },
  { amplitude: 2.8, frequency: 0.11, phase: 0.8, yOffset: 7.5, speed: 0.028, depth: 0.14, tagIndex: 1 },
  { amplitude: 3.2, frequency: 0.12, phase: 1.6, yOffset: 10.0, speed: 0.032, depth: 0.28, tagIndex: 2 },
  { amplitude: 3.8, frequency: 0.13, phase: 2.4, yOffset: 12.5, speed: 0.035, depth: 0.42, tagIndex: 3 },
  { amplitude: 4.2, frequency: 0.14, phase: 3.2, yOffset: 15.0, speed: 0.038, depth: 0.56, tagIndex: 4 },
  { amplitude: 4.8, frequency: 0.15, phase: 4.0, yOffset: 17.5, speed: 0.042, depth: 0.7, tagIndex: 5 },
  { amplitude: 5.4, frequency: 0.16, phase: 4.8, yOffset: 20.0, speed: 0.045, depth: 0.84, tagIndex: 0 },
  { amplitude: 6.0, frequency: 0.17, phase: 5.6, yOffset: 22.5, speed: 0.048, depth: 1.0, tagIndex: 2 },
];

interface Palette {
  /** Cor das linhas, uma por profundidade. */
  strokes: string[];
  /** Cor dos pontos viajantes, vinda das tags. */
  dots: string[];
}

/** Lê a paleta do CSS para o canvas acompanhar o tema atual. */
function readPalette(element: HTMLElement): Palette {
  const styles = getComputedStyle(element);
  const read = (name: string) => styles.getPropertyValue(name).trim();

  const line = read("--nx-text-tertiary") || "#74695a";
  const faint = read("--nx-border") || "#e8e2d9";

  // Camadas do fundo para a frente: da borda quase invisível ao texto terciário.
  const strokes = LAYERS.map((layer) => (layer.depth < 0.35 ? faint : line));

  const dots = [1, 2, 3, 4, 5, 6].map(
    (index) => read(`--nx-tag-${index}-text`) || line
  );

  return { strokes, dots };
}

export function SynapseWaves({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ref: containerRef, inView } = useInView<HTMLDivElement>("200px");
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const cellWidth = 11;
    const cellHeight = 13;
    let palette = readPalette(container);
    let frame = 0;
    let rafId = 0;
    let lastPaint = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = COLS * cellWidth * dpr;
      canvas!.height = ROWS * cellHeight * dpr;
      canvas!.style.width = `${COLS * cellWidth}px`;
      canvas!.style.height = `${ROWS * cellHeight}px`;
      context!.setTransform(dpr, 0, 0, dpr, 0, 0);
      context!.font = '13px "Courier New", Consolas, Monaco, monospace';
      context!.textBaseline = "top";
    }

    function draw() {
      const time = frame;
      const t = time * 0.04;
      context!.clearRect(0, 0, COLS * cellWidth, ROWS * cellHeight);

      // Célula já ocupada não é repintada, preservando a sobreposição
      // de camadas do desenho original.
      const occupied = new Set<number>();

      function put(x: number, y: number, char: string, color: string) {
        const ix = Math.round(x);
        const iy = Math.round(y);
        if (ix < 0 || ix >= COLS || iy < 0 || iy >= ROWS) return;
        const key = iy * COLS + ix;
        if (occupied.has(key)) return;
        occupied.add(key);
        context!.fillStyle = color;
        context!.fillText(char, ix * cellWidth, iy * cellHeight);
      }

      LAYERS.forEach((layer, layerIndex) => {
        const stroke = palette.strokes[layerIndex];

        for (let x = 0; x < COLS; x++) {
          const perspective = 1 + layer.depth * 0.3;
          const y =
            layer.yOffset +
            Math.sin(
              x * perspective * layer.frequency +
                t * layer.speed * 20 +
                layer.phase
            ) *
              layer.amplitude;

          const char = DASH_CHARS[Math.floor((x + time * 0.5) % DASH_CHARS.length)];
          if (char !== " ") put(x, y, char, stroke);

          // Fios cruzados que dão a leitura de "sinapse" em vez de só onda.
          if (layerIndex % 2 === 0 && x % 4 === 0) {
            const spread = (x - COLS / 2) * 0.08;
            if (Math.abs(spread) < layer.amplitude * 1.5) {
              put(x, y + spread, "·", palette.strokes[0]);
              put(x, y - spread, "·", palette.strokes[0]);
            }
          }
        }

        // Pulsos viajando pela onda — é o que dá vida ao conjunto.
        const dotCount = 2 + Math.floor(layer.depth * 4);
        for (let d = 0; d < dotCount; d++) {
          const offset = (d / dotCount) * COLS + t * layer.speed * 30;
          const dotX = ((offset % COLS) + COLS) % COLS;
          const dotY =
            layer.yOffset +
            Math.sin(
              dotX * layer.frequency + t * layer.speed * 20 + layer.phase
            ) *
              layer.amplitude;

          const dotChar =
            layer.depth > 0.7 ? "●" : layer.depth > 0.4 ? "◆" : "·";
          put(dotX, dotY, dotChar, palette.dots[layer.tagIndex]);
        }
      });
    }

    // ~30fps: o desenho é decorativo e a 60fps só dobraria o custo.
    const FRAME_MS = 1000 / 30;

    function loop(now: number) {
      rafId = requestAnimationFrame(loop);
      if (now - lastPaint < FRAME_MS) return;
      lastPaint = now;
      frame++;
      draw();
    }

    resize();

    if (reducedMotion) {
      // Um único quadro estático: mantém a textura, sem movimento.
      draw();
    } else if (inView) {
      rafId = requestAnimationFrame(loop);
    }

    // Recolhe a paleta de novo quando o tema muda.
    const themeObserver = new MutationObserver(() => {
      palette = readPalette(container!);
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(rafId);
      themeObserver.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [inView, reducedMotion, containerRef]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={className}
    >
      <canvas ref={canvasRef} className="size-full object-cover" />
    </div>
  );
}
