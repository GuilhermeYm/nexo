"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  FileText,
  Image as ImageIcon,
  Link2,
  Mic,
  PenLine,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { useInView, usePrefersReducedMotion } from "@/hooks/use-in-view";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

/**
 * O mapa mental do "Como Funciona".
 *
 * A ideia: no fundo da seção de funcionalidades, as ondas ASCII são ruído
 * bonito. Aqui a mesma gramática de caracteres se resolve em estrutura — os
 * traços viram arestas de verdade entre nós de verdade. É o argumento do
 * produto feito ao pé da letra: entra bagunça, sai organização.
 *
 * Arquitetura: os nós são DOM real (legíveis, selecionáveis, tematizados) e o
 * canvas só desenha o tecido conectivo. O canvas mede a posição real dos nós a
 * cada resize, então o desenho acompanha qualquer breakpoint sem uma segunda
 * tabela de coordenadas para as linhas.
 */

type NodeKind = "fragment" | "nexus" | "workspace" | "tag" | "junction" | "fork";

interface MapNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Segunda linha, só nos nós de bifurcação. */
  detail?: string;
  icon?: LucideIcon;
  /** Classe de cor do ponto/chip, vinda da paleta de tags. */
  tone?: string;
  /** Posição em % do container: [x, y]. `null` no mobile = nó oculto. */
  desktop: readonly [number, number];
  mobile: readonly [number, number] | null;
}

const NODES: readonly MapNode[] = [
  // Entrada: o que o usuário joga dentro, sem ordem nenhuma.
  { id: "f1", kind: "fragment", label: "áudio da reunião", icon: Mic, desktop: [7, 9], mobile: [24, 3] },
  { id: "f2", kind: "fragment", label: "contrato.pdf", icon: FileText, desktop: [5, 24], mobile: [70, 6.5] },
  { id: "f3", kind: "fragment", label: "foto do quadro", icon: ImageIcon, desktop: [8, 39], mobile: [36, 11] },
  { id: "f4", kind: "fragment", label: "link salvo", icon: Link2, desktop: [4, 54], mobile: null },
  { id: "f5", kind: "fragment", label: "ideia às 2h", icon: PenLine, desktop: [8, 69], mobile: null },

  // O agente.
  { id: "nexus", kind: "nexus", label: "Nexo", desktop: [31, 38], mobile: [50, 22] },

  // A estrutura que ele devolve.
  { id: "w1", kind: "workspace", label: "Trabalho", tone: "bg-tag-4-foreground", desktop: [57, 11], mobile: [27, 36] },
  { id: "w2", kind: "workspace", label: "Estudo", tone: "bg-tag-3-foreground", desktop: [59, 32], mobile: [27, 48] },
  { id: "w3", kind: "workspace", label: "Pessoal", tone: "bg-tag-5-foreground", desktop: [57, 53], mobile: [27, 60] },

  { id: "t1", kind: "tag", label: "#reunião", tone: "bg-tag-2 text-tag-2-foreground", desktop: [82, 4], mobile: [73, 32] },
  { id: "t2", kind: "tag", label: "#contrato", tone: "bg-tag-4 text-tag-4-foreground", desktop: [84, 17], mobile: null },
  { id: "t3", kind: "tag", label: "#pesquisa", tone: "bg-tag-1 text-tag-1-foreground", desktop: [82, 27], mobile: [73, 44] },
  { id: "t4", kind: "tag", label: "#artigo", tone: "bg-tag-6 text-tag-6-foreground", desktop: [84, 39], mobile: null },
  { id: "t5", kind: "tag", label: "#ideia", tone: "bg-tag-3 text-tag-3-foreground", desktop: [82, 49], mobile: [73, 56] },
  { id: "t6", kind: "tag", label: "#agenda", tone: "bg-tag-5 text-tag-5-foreground", desktop: [84, 61], mobile: null },

  // Ponto de decisão: tudo que foi organizado chega aqui e se divide em dois.
  { id: "junction", kind: "junction", label: "", desktop: [50, 72], mobile: [50, 71] },

  {
    id: "auto",
    kind: "fork",
    label: "Deixa no automático",
    detail: "A Nexo segue lendo, marcando e arrumando cada captura nova. Você nunca abre uma pasta.",
    desktop: [24, 89],
    mobile: [50, 82],
  },
  {
    id: "manual",
    kind: "fork",
    label: "Assume o controle",
    detail: "Blocos, hierarquia e links passam a ser seus. A Nexo continua organizando ao redor do que você montar.",
    desktop: [72, 90],
    mobile: [50, 94],
  },
] as const;

interface MapEdge {
  from: string;
  to: string;
  /** Curvatura perpendicular, em fração da distância. Sinal escolhe o lado. */
  bend: number;
  /** Índice 1-6 na paleta de tags, para o pulso que viaja pela aresta. */
  hue: number;
  /** Ordem de entrada na construção do mapa. */
  stage: number;
}

const EDGES: readonly MapEdge[] = [
  // Estágio 0 — a captura converge para o agente.
  { from: "f1", to: "nexus", bend: 0.1, hue: 2, stage: 0 },
  { from: "f2", to: "nexus", bend: 0.07, hue: 4, stage: 0 },
  { from: "f3", to: "nexus", bend: -0.04, hue: 1, stage: 0 },
  { from: "f4", to: "nexus", bend: -0.07, hue: 6, stage: 0 },
  { from: "f5", to: "nexus", bend: -0.1, hue: 5, stage: 0 },

  // Estágio 1 — o agente devolve workspaces.
  { from: "nexus", to: "w1", bend: -0.12, hue: 4, stage: 1 },
  { from: "nexus", to: "w2", bend: 0.05, hue: 3, stage: 1 },
  { from: "nexus", to: "w3", bend: 0.12, hue: 5, stage: 1 },

  // Estágio 2 — cada workspace floresce em tags.
  { from: "w1", to: "t1", bend: -0.14, hue: 2, stage: 2 },
  { from: "w1", to: "t2", bend: 0.1, hue: 4, stage: 2 },
  { from: "w2", to: "t3", bend: -0.12, hue: 1, stage: 2 },
  { from: "w2", to: "t4", bend: 0.1, hue: 6, stage: 2 },
  { from: "w3", to: "t5", bend: -0.12, hue: 3, stage: 2 },
  { from: "w3", to: "t6", bend: 0.1, hue: 5, stage: 2 },

  // Estágio 3 — tudo converge no ponto de decisão. A curvatura é negativa de
  // propósito: w1 e w2 descem quase na vertical até a junção e, sem isso,
  // cortam a coluna de workspaces por dentro, empilhando traço em cima de nó.
  // Curvando para fora, elas contornam pelo corredor entre workspaces e tags.
  { from: "w1", to: "junction", bend: -0.26, hue: 4, stage: 3 },
  { from: "w2", to: "junction", bend: -0.18, hue: 3, stage: 3 },
  { from: "w3", to: "junction", bend: -0.1, hue: 5, stage: 3 },

  // ...e se abre em dois caminhos que ficam abertos o tempo todo.
  { from: "junction", to: "auto", bend: 0.1, hue: 1, stage: 4 },
  { from: "junction", to: "manual", bend: -0.1, hue: 6, stage: 4 },
] as const;

/** Verbos que o agente executa, revezando no nó central. */
const AGENT_VERBS = ["lê", "resume", "classifica", "marca", "conecta"] as const;

const CELL_W = 10;
const CELL_H = 12;
/** Folga em volta de cada nó — impede o ASCII de correr por baixo do texto. */
const NODE_PADDING = 7;

interface Anchor {
  cx: number;
  cy: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Point {
  x: number;
  y: number;
}

function quadratic(p0: Point, control: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * control.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * control.y + t * t * p1.y,
  };
}

/** Ponto de controle deslocado na perpendicular — dá o arco de cada aresta. */
function controlPoint(p0: Point, p1: Point, bend: number): Point {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const distance = Math.hypot(dx, dy) || 1;
  return {
    x: (p0.x + p1.x) / 2 - (dy / distance) * distance * bend,
    y: (p0.y + p1.y) / 2 + (dx / distance) * distance * bend,
  };
}

/** Caractere escolhido pela inclinação local — é o que dá leitura de desenho. */
function strokeChar(dx: number, dy: number): string {
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle < 0) angle += 180;
  if (angle < 22.5 || angle >= 157.5) return "-";
  if (angle < 67.5) return "\\";
  if (angle < 112.5) return "|";
  return "/";
}

export function SynapseMap({ className }: { className?: string }) {
  const { ref: containerRef, inView } = useInView<HTMLDivElement>("160px");
  const reducedMotion = usePrefersReducedMotion();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Quanto de cada aresta já foi desenhada (0..1). Objetos porque o GSAP
  // precisa de alvos mutáveis para animar com stagger.
  const reveals = useRef(EDGES.map(() => ({ value: 0 })));
  // O verbo que pisca no nexo. Com "reduzir movimento" ele não cicla: mostra
  // todos de uma vez, derivado — nada de setState dentro de efeito.
  const [cycledVerb, setCycledVerb] = useState<string>(AGENT_VERBS[0]);
  const verb = reducedMotion ? AGENT_VERBS.join(" · ") : cycledVerb;

  // ——— Canvas: mede os nós e desenha o tecido conectivo ———
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let anchors: Record<string, Anchor> = {};
    let strokeColor = "#74695a";
    let dotColors: string[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let rafId = 0;
    let lastPaint = 0;

    function readPalette() {
      const styles = getComputedStyle(container!);
      const read = (name: string) => styles.getPropertyValue(name).trim();
      strokeColor = read("--nx-text-tertiary") || "#74695a";
      dotColors = [1, 2, 3, 4, 5, 6].map(
        (index) => read(`--nx-tag-${index}-text`) || strokeColor
      );
    }

    function measure() {
      const bounds = container!.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      context!.setTransform(dpr, 0, 0, dpr, 0, 0);
      context!.font = `${CELL_H}px "Courier New", Consolas, Monaco, monospace`;
      context!.textBaseline = "top";

      anchors = {};
      for (const node of NODES) {
        const element = nodeRefs.current[node.id];
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        // Nó escondido pelo breakpoint (display:none) mede zero — sem âncora,
        // as arestas que chegam nele simplesmente não são desenhadas.
        if (rect.width === 0 && rect.height === 0) continue;
        anchors[node.id] = {
          cx: rect.left - bounds.left + rect.width / 2,
          cy: rect.top - bounds.top + rect.height / 2,
          left: rect.left - bounds.left - NODE_PADDING,
          top: rect.top - bounds.top - NODE_PADDING,
          right: rect.right - bounds.left + NODE_PADDING,
          bottom: rect.bottom - bounds.top + NODE_PADDING,
        };
      }
    }

    function draw() {
      const cols = Math.ceil(width / CELL_W);
      const rows = Math.ceil(height / CELL_H);
      context!.clearRect(0, 0, width, height);

      // Células já ocupadas não são repintadas: preserva a sobreposição das
      // arestas.
      const occupied = new Set<number>();

      // Só o nexo reserva o próprio retângulo. Os demais nós são pílulas
      // opacas desenhadas por cima do canvas, então ASCII que passe por baixo
      // simplesmente não aparece — reservar o retângulo deles não protege
      // nada e, no mobile, onde os chips ocupam quase a largura inteira,
      // apaga o meio das arestas que passam atrás e parte o mapa em pedaços.
      // O nexo é a exceção porque é redondo: sem a reserva, os cantos do
      // retângulo deixariam traço colado na circunferência.
      const nexusAnchor = anchors["nexus"];
      if (nexusAnchor) {
        const x0 = Math.max(0, Math.floor(nexusAnchor.left / CELL_W));
        const x1 = Math.min(cols - 1, Math.ceil(nexusAnchor.right / CELL_W));
        const y0 = Math.max(0, Math.floor(nexusAnchor.top / CELL_H));
        const y1 = Math.min(rows - 1, Math.ceil(nexusAnchor.bottom / CELL_H));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) occupied.add(y * cols + x);
        }
      }

      function put(px: number, py: number, char: string, color: string) {
        const x = Math.round(px / CELL_W);
        const y = Math.round(py / CELL_H);
        if (x < 0 || x >= cols || y < 0 || y >= rows) return;
        const key = y * cols + x;
        if (occupied.has(key)) return;
        occupied.add(key);
        context!.fillStyle = color;
        context!.fillText(char, x * CELL_W, y * CELL_H);
      }

      EDGES.forEach((edge, edgeIndex) => {
        const from = anchors[edge.from];
        const to = anchors[edge.to];
        if (!from || !to) return;

        const reveal = reveals.current[edgeIndex].value;
        if (reveal <= 0) return;

        const p0 = { x: from.cx, y: from.cy };
        const p1 = { x: to.cx, y: to.cy };
        const control = controlPoint(p0, p1, edge.bend);
        const span = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const samples = Math.max(12, Math.ceil((span * 1.25) / 4));

        let previous = p0;
        for (let i = 1; i <= samples; i++) {
          const t = i / samples;
          if (t > reveal) break;

          const point = quadratic(p0, control, p1, t);

          // Buraco viajando pela linha: a aresta respira em vez de ficar
          // um traço morto. Mesma ideia dos DASH_CHARS das ondas.
          const gap = (i + frame * 0.55) % 11;
          if (gap >= 9.4) {
            previous = point;
            continue;
          }

          const char =
            gap < 1
              ? "·"
              : strokeChar(point.x - previous.x, point.y - previous.y);
          put(point.x, point.y, char, strokeColor);
          previous = point;
        }

        // Pulso viajando no sentido do fluxo: é o que mostra que a informação
        // está indo para algum lugar, e não que existe uma linha ali.
        const speed = 0.0042 + (edgeIndex % 4) * 0.0006;
        const offset = (edgeIndex * 0.37) % 1;
        const position = (frame * speed + offset) % 1;
        if (position <= reveal) {
          const dot = quadratic(p0, control, p1, position);
          put(dot.x, dot.y, "●", dotColors[(edge.hue - 1) % 6] ?? strokeColor);
        }
      });
    }

    // ~30fps: o desenho é atmosférico e a 60fps só dobraria o custo.
    const FRAME_MS = 1000 / 30;

    function loop(now: number) {
      rafId = requestAnimationFrame(loop);
      if (now - lastPaint < FRAME_MS) return;
      lastPaint = now;
      frame++;
      draw();
    }

    readPalette();
    measure();

    if (reducedMotion) {
      // Sem movimento: o mapa já nasce inteiro, só não pulsa.
      reveals.current.forEach((entry) => (entry.value = 1));
      draw();
    } else if (inView) {
      rafId = requestAnimationFrame(loop);
    } else {
      draw();
    }

    const resizeObserver = new ResizeObserver(() => {
      measure();
      draw();
    });
    resizeObserver.observe(container);

    const themeObserver = new MutationObserver(() => {
      readPalette();
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
    };
  }, [containerRef, inView, reducedMotion]);

  // ——— Construção do mapa: nós entram e arestas crescem, por estágio ———
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (reducedMotion) {
      reveals.current.forEach((entry) => (entry.value = 1));
      return;
    }

    const ctx = gsap.context(() => {
      const revealsForStage = (stage: number) =>
        reveals.current.filter((_, index) => EDGES[index].stage === stage);

      const build = gsap.timeline({
        scrollTrigger: { trigger: container, start: "top 72%", once: true },
        defaults: { ease: "power3.out" },
      });

      build
        .from("[data-node='nexus']", { opacity: 0, scale: 0.7, duration: 0.7 })
        .from(
          "[data-node='fragment']",
          { opacity: 0, x: -18, duration: 0.5, stagger: 0.09 },
          0.15
        )
        .to(revealsForStage(0), { value: 1, duration: 0.75, stagger: 0.09 }, 0.4)
        .from(
          "[data-node='workspace']",
          { opacity: 0, x: 20, duration: 0.55, stagger: 0.11 },
          1.15
        )
        .to(revealsForStage(1), { value: 1, duration: 0.6, stagger: 0.11 }, 1.05)
        .from(
          "[data-node='tag']",
          { opacity: 0, scale: 0.55, duration: 0.45, stagger: 0.07 },
          1.95
        )
        .to(revealsForStage(2), { value: 1, duration: 0.5, stagger: 0.07 }, 1.85)
        .to(revealsForStage(3), { value: 1, duration: 0.7, stagger: 0.1 }, 2.6)
        .to(revealsForStage(4), { value: 1, duration: 0.7, stagger: 0.14 }, 3.1)
        .from(
          "[data-node='fork']",
          { opacity: 0, y: 22, duration: 0.6, stagger: 0.16 },
          3.35
        );

      // O agente trabalhando: o verbo troca no nó central, mesma linguagem de
      // conteúdo vivo que a busca e a classificação usam nas funcionalidades.
      const verbs = gsap.timeline({ repeat: -1, delay: 1.2 });
      AGENT_VERBS.forEach((next) => {
        verbs
          .to("[data-el='verb']", { opacity: 0, y: -6, duration: 0.18 })
          .call(() => setCycledVerb(next))
          .to("[data-el='verb']", { opacity: 1, y: 0, duration: 0.22 })
          .to({}, { duration: 0.95 });
      });
    }, container);

    return () => ctx.revert();
  }, [containerRef, reducedMotion]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full",
        // Mobile lê como espinha vertical; desktop abre no fluxo horizontal.
        "h-[1020px] md:h-[660px] lg:h-[700px]",
        className
      )}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
      />

      {NODES.map((node) => {
        const Icon = node.icon;
        // As duas coordenadas viajam como custom properties e o breakpoint é
        // resolvido pelo CSS. Fazer isso no JS renderizaria mobile no servidor
        // e desktop no cliente — mismatch de hidratação garantido.
        const position = {
          "--nx-map-x": `${(node.mobile ?? node.desktop)[0]}%`,
          "--nx-map-y": `${(node.mobile ?? node.desktop)[1]}%`,
          "--nx-map-dx": `${node.desktop[0]}%`,
          "--nx-map-dy": `${node.desktop[1]}%`,
        } as CSSProperties;

        return (
          <div
            key={node.id}
            data-node={node.kind}
            ref={(element) => {
              nodeRefs.current[node.id] = element;
            }}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2",
              "left-[var(--nx-map-x)] top-[var(--nx-map-y)]",
              "md:left-[var(--nx-map-dx)] md:top-[var(--nx-map-dy)]",
              // Nós que só cabem no desktop.
              node.mobile === null ? "hidden md:block" : "block"
            )}
            style={position}
          >
            {node.kind === "fragment" && (
              <span className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs whitespace-nowrap text-subtle-foreground">
                {Icon && <Icon className="size-3.5 shrink-0" />}
                {node.label}
              </span>
            )}

            {node.kind === "nexus" && (
              <span className="relative flex size-28 flex-col items-center justify-center rounded-full bg-accent text-accent-foreground md:size-32">
                <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-accent opacity-15 [animation-duration:3s] motion-reduce:hidden" />
                <span className="text-base font-bold tracking-tight md:text-lg">
                  Nexo
                </span>
                <span
                  data-el="verb"
                  className="mt-0.5 text-xs text-accent-foreground/70"
                >
                  {verb}
                </span>
              </span>
            )}

            {node.kind === "workspace" && (
              <span className="flex items-center gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm whitespace-nowrap text-foreground">
                <span className={cn("size-2 shrink-0 rounded-full", node.tone)} />
                {node.label}
              </span>
            )}

            {node.kind === "tag" && (
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                  node.tone
                )}
              >
                {node.label}
              </span>
            )}

            {node.kind === "junction" && (
              <span className="block size-2 rounded-full bg-subtle-foreground" />
            )}

            {node.kind === "fork" && (
              <div className="w-[16rem] rounded-2xl border border-border bg-background p-4 md:w-[15rem]">
                {/* Título de verdade: leitores de tela precisam alcançar as
                    duas saídas do mapa pela lista de cabeçalhos. */}
                <h3 className="text-sm font-semibold text-foreground">
                  {node.label}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {node.detail}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
