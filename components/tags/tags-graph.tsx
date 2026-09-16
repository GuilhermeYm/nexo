"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ReactElement, RefObject } from "react";
import { Maximize, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

import type {
  ForceGraphMethods,
  ForceGraphProps,
  LinkObject,
  NodeObject,
} from "react-force-graph-2d";
import { TAG_PALETTE, paletteFromName } from "@/lib/tags/palette";
import type { TagGraph } from "@/lib/tags/queries";
import { cn } from "@/lib/utils";

/**
 * A lib de força é pesada (d3 + canvas): só desce quando o modo grafo abre.
 * O cast para `ForceGraph2DComponent` (em vez de `ComponentType`) preserva o
 * `ref` — é por ele que os botões de zoom falam com o gráfico.
 */
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-96 items-center justify-center rounded-2xl border border-border bg-secondary/40">
      <span className="text-sm text-muted-foreground">Carregando o grafo…</span>
    </div>
  ),
}) as unknown as ForceGraph2DComponent;

type ForceGraph2DComponent = (
  props: ForceGraphProps<GraphNodeData, GraphLinkData> & {
    ref?: RefObject<ForceGraphMethods<GraphNode, GraphLink> | undefined>;
  }
) => ReactElement;

interface GraphNodeData {
  kind: "note" | "tag";
  name: string;
  label: string;
  color: string | null;
  /** Quantas ligações o nó tem — é o que o raio comunica. */
  degree: number;
  /** Raio em unidades do grafo, já calculado: o desenho é nosso, não da lib. */
  radius: number;
}

interface GraphLinkData {
  source: string;
  target: string;
}

type GraphNode = NodeObject<GraphNodeData>;
type GraphLink = LinkObject<GraphNodeData, GraphLinkData>;

const TAU = 2 * Math.PI;

/**
 * Um nó de tag cresce muito mais que um de nota, e os dois intervalos não se
 * encostam: no grafo antigo (3–8 contra 4–10) uma nota popular ficava do
 * tamanho de uma tag, e o tamanho parava de significar qualquer coisa.
 */
function radiusFor(kind: "note" | "tag", degree: number): number {
  return kind === "tag"
    ? 6.5 + Math.min(degree, 14) * 0.6
    : 4 + Math.min(degree, 6) * 0.4;
}

/** Título longo vira reticências: o rótulo é uma etiqueta, não o conteúdo. */
function truncate(text: string, max: number): string {
  const clean = text.trim() || "Sem título";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Os tokens do tema são hex (`#rrggbb`) em `globals.css`, então dá para
 * rebaixá-los com alfa sem repintar nada. É assim que o que está fora do foco
 * **recua** em vez de sumir: trocar a cor por `border` no tema claro apagava o
 * resto do grafo, porque a borda (#e8e2d9) é quase o próprio papel.
 */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `#${hex[1]}${byte.toString(16).padStart(2, "0")}`;
}

/**
 * O canvas não resolve `var(--color-…)`: um `fillStyle` com variável CSS é
 * valor inválido e é ignorado em silêncio — e, pior, a lib cai num azul
 * padrão quando a cor resolvida é falsy. Por isso os tokens do tema são
 * resolvidos aqui, via estilo computado, e o que chega ao canvas é a cor já
 * pronta.
 *
 * Duas pegadas descobertas na prática:
 *
 * - O Tailwind v4 tree-shakea variáveis de `@theme inline` sem consumidor:
 *   só existem no CSS computado as `--color-tag-N` que alguma utility usa.
 *   As tons das tags vêm então de `--nx-tag-N-text` (variável comum de
 *   `:root`, nunca shakeada) — que é o mesmo tom saturado das bolinhas dos
 *   chips na lista, não o tom de fundo pálido (invisível sobre o papel).
 * - O acesso ao mapa é por string com hífen (`colors["muted-foreground"]`):
 *   `colors.mutedForeground` é `undefined` — undefined é falsy e a lib
 *   pintava o nó de azul.
 *
 * O `MutationObserver` refaz o mapa quando o tema troca (`data-theme` em
 * `<html>`), mantendo o grafo consistente com o resto da tela.
 */
const RESOLVED_COLOR_TOKENS = [
  ...TAG_PALETTE.map((position) => `tag-${position}`),
  "background",
  "foreground",
  "muted-foreground",
  "subtle-foreground",
  "border",
] as const;

type ResolvedColorKey = (typeof RESOLVED_COLOR_TOKENS)[number];

/**
 * Toda chave resolve pela camada `--nx-*`, nunca pela `--color-*`.
 *
 * A regra vale para todas e não só para as tags: `--color-background` **não
 * existe** no estilo computado, porque `@theme inline` inlina o valor na
 * utility em vez de publicar a variável. O retorno é string vazia, e
 * `fillStyle = ""` é descartado sem erro — o canvas fica com a cor anterior, e
 * o nó de nota saía preto (a cor inicial do contexto) ou pintado com o tom da
 * tag desenhada antes dele. Ler da camada comum de `:root` tira a classe
 * inteira de defeito do caminho.
 */
const CSS_VARIABLE_BY_TOKEN: Record<ResolvedColorKey, string> = {
  "tag-1": "--nx-tag-1-text",
  "tag-2": "--nx-tag-2-text",
  "tag-3": "--nx-tag-3-text",
  "tag-4": "--nx-tag-4-text",
  "tag-5": "--nx-tag-5-text",
  "tag-6": "--nx-tag-6-text",
  background: "--nx-bg-primary",
  foreground: "--nx-text-primary",
  "muted-foreground": "--nx-text-secondary",
  "subtle-foreground": "--nx-text-tertiary",
  border: "--nx-border",
};

/** Se algum token sumir do tema, o desenho cai num cinza — nunca em vazio. */
const COLOR_FALLBACK = "#808080";

interface ResolvedTheme {
  colors: Record<ResolvedColorKey, string>;
  /** A mesma família do resto da interface — o rótulo no canvas não é outra voz. */
  fontFamily: string;
}

function useResolvedTheme(): ResolvedTheme | null {
  const [theme, setTheme] = useState<ResolvedTheme | null>(null);

  useEffect(() => {
    function resolve() {
      const style = getComputedStyle(document.documentElement);
      const colors = {} as Record<ResolvedColorKey, string>;
      for (const token of RESOLVED_COLOR_TOKENS) {
        colors[token] =
          style.getPropertyValue(CSS_VARIABLE_BY_TOKEN[token]).trim() ||
          COLOR_FALLBACK;
      }
      setTheme({
        colors,
        fontFamily:
          getComputedStyle(document.body).fontFamily ||
          "ui-sans-serif, system-ui, sans-serif",
      });
    }

    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

/** As forças ficam escondidas atrás de um tipo frouxo na lib. */
interface TunableForce {
  strength?: (value: number | ((node: GraphNode) => number)) => TunableForce;
  distanceMax?: (value: number) => TunableForce;
  distance?: (value: number) => TunableForce;
}

/**
 * Uma atração fraca de cada nó para a origem.
 *
 * O `center` que a simulação traz não puxa nó nenhum: ele só desloca o sistema
 * inteiro para que o **centroide** caia no meio. Com isso, uma nota sem tag —
 * que não tem aresta que a segure — saía empurrada pela repulsão e ficava
 * onde parasse, longe. Ninguém a trazia de volta, e o "ajustar ao conteúdo"
 * precisava caber essa distância: o agrupamento real encolhia no meio da tela
 * por causa de dois pontos soltos.
 *
 * A força é proporcional à distância, então ela praticamente não se sente
 * dentro do agrupamento e fica firme com quem escapou. Uma força do d3 é só
 * uma função com `initialize` — não vale trazer o pacote inteiro por dez
 * linhas.
 */
function createCenterPull(strength: number) {
  let pulled: GraphNode[] = [];
  function force(alpha: number) {
    for (const node of pulled) {
      node.vx = (node.vx ?? 0) - (node.x ?? 0) * strength * alpha;
      node.vy = (node.vy ?? 0) - (node.y ?? 0) * strength * alpha;
    }
  }
  force.initialize = (input: GraphNode[]) => {
    pulled = input;
  };
  return force;
}

export function TagsGraph({
  notes,
  tags,
  links,
  onTagColorChange,
}: TagGraph & {
  /** Avisa a tela quando uma cor grava de verdade, para a lista acompanhar. */
  onTagColorChange?: (tagId: string, color: string | null) => void;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(
    undefined
  );
  const theme = useResolvedTheme();

  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedTag, setSelectedTag] = useState<{
    id: string;
    name: string;
    color: string | null;
  } | null>(null);
  const [savingColor, setSavingColor] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [zoomK, setZoomK] = useState(1);
  const [width, setWidth] = useState(800);

  // A altura acompanha a largura: em telas largas o grafo respira, em
  // estreitas não esmaga o conteúdo abaixo dele.
  const height = Math.round(Math.min(640, Math.max(460, width * 0.62)));

  // Mede a largura do contêiner uma vez montado, e de novo quando ele muda.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = () => setWidth(element.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Escape fecha o editor de cor, como fecha tudo no resto do app.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedTag(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Os nós: notas e tags, cada um com um tamanho proporcional ao grau.
  //
  // Quando uma prop muda (uma cor nova, por exemplo), rebuild com nós novos
  // descartaria x/y e o grafo se recomporia do zero na cara de quem estava
  // olhando. Os nós vivem em estado e o rebuild carrega as posições do
  // arranjo anterior — o padrão documentado de "ajustar estado quando a prop
  // muda". Como a simulação muta os nós in-place, as posições copiadas são as
  // de agora, não as do último commit.
  const [layout, setLayout] = useState<{
    notes: TagGraph["notes"];
    tags: TagGraph["tags"];
    links: TagGraph["links"];
    nodes: GraphNode[];
  } | null>(null);

  if (
    !layout ||
    layout.notes !== notes ||
    layout.tags !== tags ||
    layout.links !== links
  ) {
    const degree = new Map<string, number>();
    for (const link of links) {
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
    }

    const previousById = new Map(
      (layout?.nodes ?? []).map((node) => [String(node.id), node])
    );
    const carryOver = (id: string): Partial<GraphNode> => {
      const previous = previousById.get(id);
      if (!previous) return {};
      return {
        x: previous.x,
        y: previous.y,
        vx: previous.vx,
        vy: previous.vy,
      };
    };

    setLayout({
      notes,
      tags,
      links,
      nodes: [
        ...notes.map((note): GraphNode => {
          const nodeDegree = degree.get(note.id) ?? 0;
          return {
            id: note.id,
            kind: "note",
            name: note.title,
            label: truncate(note.title, 26),
            color: null,
            degree: nodeDegree,
            radius: radiusFor("note", nodeDegree),
            ...carryOver(note.id),
          };
        }),
        ...tags.map((tag): GraphNode => {
          const nodeDegree = degree.get(tag.id) ?? 0;
          return {
            id: tag.id,
            kind: "tag",
            name: tag.name,
            label: `#${truncate(tag.name, 20)}`,
            color: tag.color,
            degree: nodeDegree,
            radius: radiusFor("tag", nodeDegree),
            ...carryOver(tag.id),
          };
        }),
      ],
    });
  }

  const nodes = layout?.nodes ?? [];
  const graphLinks = links as GraphLink[];

  // Em hover, o foco é o nó e a sua vizinhança; o resto do grafo recua.
  const highlightIds = useMemo(() => {
    if (!hoveredNode) return null;
    const ids = new Set<string>([String(hoveredNode.id)]);
    for (const link of graphLinks) {
      const source = link.source as unknown as GraphNode | string;
      const target = link.target as unknown as GraphNode | string;
      const sourceId = typeof source === "string" ? source : String(source.id);
      const targetId = typeof target === "string" ? target : String(target.id);
      if (sourceId === hoveredNode.id) ids.add(targetId);
      if (targetId === hoveredNode.id) ids.add(sourceId);
    }
    return ids;
  }, [hoveredNode, graphLinks]);

  /* --- Desenho ------------------------------------------------------------ */

  /**
   * Afastar não podia continuar afastando: sem rótulo, cada nó era um ponto
   * anônimo e a única forma de saber o que era o quê era passar o mouse, um
   * por um. A tag escreve o nome sempre; a nota só quando há espaço de sobra
   * (zoom alto) ou quando ela está na vizinhança em foco — senão o grafo
   * inteiro vira um bloco de texto.
   */
  const drawNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (!theme) return;
      const { colors } = theme;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const dimmed = Boolean(
        highlightIds && !highlightIds.has(String(node.id))
      );
      const radius = node.radius;

      const tone =
        node.kind === "tag"
          ? colors[`tag-${node.color ?? paletteFromName(node.name)}`] ||
            colors["muted-foreground"]
          : colors["muted-foreground"];

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.2 : 1;

      // Um anel do fundo por trás do nó: onde muitas arestas se cruzam, o nó
      // continua sendo uma forma e não um borrão.
      ctx.beginPath();
      ctx.arc(x, y, radius + 1.6 / globalScale, 0, TAU);
      ctx.fillStyle = colors.background;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      if (node.kind === "tag") {
        // Tag: disco cheio, na matiz dela. Nota: anel vazado, neutro. A
        // diferença entre os dois é de forma, não só de cor — funciona no
        // tema escuro, no claro e para quem não distingue as matizes.
        ctx.fillStyle = tone;
        ctx.fill();
      } else {
        ctx.fillStyle = colors.background;
        ctx.fill();
        ctx.lineWidth = 1.6 / globalScale;
        ctx.strokeStyle = tone;
        ctx.stroke();
      }

      const focused = String(node.id) === String(hoveredNode?.id);
      if (focused) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3.5 / globalScale, 0, TAU);
        ctx.lineWidth = 1.5 / globalScale;
        ctx.strokeStyle = colors.foreground;
        ctx.stroke();
      }

      const showLabel =
        node.kind === "tag" ||
        focused ||
        globalScale > 1.8 ||
        Boolean(highlightIds && !dimmed);

      if (showLabel) {
        const isTag = node.kind === "tag";
        const fontSize = (isTag ? 11.5 : 10) / globalScale;
        ctx.font = `${isTag ? 600 : 400} ${fontSize}px ${theme.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        // O rótulo é escrito na cor do texto, não na da tag: as seis matizes
        // do tema são tons rebaixados para conviver com o papel e não passam
        // 4,5:1 em corpo pequeno. A cor fica no disco, que é uma forma.
        const labelY = y + radius + 3 / globalScale;
        ctx.fillStyle = isTag ? colors.foreground : colors["muted-foreground"];

        // O destaque sobre a aresta é sombra macia, não contorno. Um
        // `strokeText` na cor do fundo é desenhado metade para dentro do
        // glifo: no tema claro, onde o traço claro invade a letra escura, ele
        // comia a haste e o texto chegava borrado. A sombra fica toda por
        // fora — duas passadas para ela ganhar corpo.
        ctx.shadowColor = colors.background;
        ctx.shadowBlur = 4 / globalScale;
        ctx.fillText(node.label, x, labelY);
        ctx.fillText(node.label, x, labelY);
        ctx.shadowBlur = 0;
        ctx.fillText(node.label, x, labelY);
      }

      ctx.restore();
    },
    [theme, highlightIds, hoveredNode]
  );

  /**
   * Com desenho próprio, a área clicável também é nossa: sem isto a lib usaria
   * `nodeRelSize` e o alvo não bateria com o círculo que a pessoa vê.
   */
  const paintPointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, node.radius + 3, 0, TAU);
      ctx.fill();
    },
    []
  );

  const linkColor = useCallback(
    (link: GraphLink) => {
      if (!theme) return "#cccccc";
      // A aresta é o conteúdo do grafo, não moldura: a 0,35 ela simplesmente
      // não existia no tema escuro (#8c8c93 rebaixado sobre #0f0f11).
      const base = theme.colors["subtle-foreground"];
      if (!highlightIds) return withAlpha(base, 0.55);

      const source = link.source as unknown as GraphNode | string;
      const target = link.target as unknown as GraphNode | string;
      const sourceId = typeof source === "string" ? source : String(source.id);
      const targetId = typeof target === "string" ? target : String(target.id);
      const inFocus =
        sourceId === hoveredNode?.id || targetId === hoveredNode?.id;
      return inFocus ? withAlpha(base, 1) : withAlpha(base, 0.1);
    },
    [theme, highlightIds, hoveredNode]
  );

  const linkWidth = useCallback(
    (link: GraphLink) => {
      if (!highlightIds || !hoveredNode) return 1;
      const source = link.source as unknown as GraphNode | string;
      const target = link.target as unknown as GraphNode | string;
      const sourceId = typeof source === "string" ? source : String(source.id);
      const targetId = typeof target === "string" ? target : String(target.id);
      return sourceId === hoveredNode.id || targetId === hoveredNode.id
        ? 1.8
        : 1;
    },
    [highlightIds, hoveredNode]
  );

  /* --- Arranjo ------------------------------------------------------------ */

  // Duas coisas, e a segunda é a que mais mudou a tela.
  //
  // O padrão da lib espalha pouco e deixa os nós encavalados; com rótulo
  // desenhado isso vira texto sobre texto — daí mais repulsão e aresta mais
  // longa, para o rótulo caber no espaço que ele passou a ocupar.
  //
  // E a repulsão é **por nó**: uma nota sem tag nenhuma não tem aresta que a
  // segure, então com a força uniforme ela era arremessada para um canto
  // vazio e passava a definir sozinha o retângulo do "ajustar ao conteúdo" —
  // o agrupamento inteiro encolhia no meio por causa de um ponto solto. Ela
  // continua na tela (uma nota sem tag é exatamente o que vale enxergar aqui),
  // só que perto de casa.
  //
  // Ajustar isto por `useEffect` não funcionava, e o sintoma era não haver
  // sintoma: o grafo desce por `next/dynamic`, então no efeito da montagem o
  // `fgRef` ainda está vazio, o efeito sai pelo `if (!fg)` e nunca é chamado
  // de novo — a dependência (`nodes.length`) não muda quando a lib chega.
  // Nenhuma das forças abaixo valia nada. O primeiro tique é o gancho certo:
  // é o instante em que existe instância e a simulação ainda não andou.
  const forcesTunedRef = useRef(false);
  const tuneForces = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || forcesTunedRef.current) return;
    forcesTunedRef.current = true;

    (fg.d3Force("charge") as TunableForce | undefined)
      ?.strength?.((node: GraphNode) => (node.degree === 0 ? -55 : -320))
      ?.distanceMax?.(520);
    (fg.d3Force("link") as TunableForce | undefined)?.distance?.(64);
    (
      fg as unknown as { d3Force: (name: string, force: unknown) => void }
    ).d3Force("centerPull", createCenterPull(0.14));
  }, []);

  useEffect(() => {
    forcesTunedRef.current = false;
  }, [nodes.length]);

  // Enquadrar sozinho na primeira parada. Antes o grafo abria em 100% fixo e
  // os componentes soltos iam parar fora da moldura — a primeira coisa que a
  // pessoa via era metade de um nó cortado na borda.
  const fittedRef = useRef(false);
  useEffect(() => {
    fittedRef.current = false;
  }, [nodes.length]);

  /* --- Interação ---------------------------------------------------------- */

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.kind === "note" && typeof node.id === "string") {
        router.push(`/nota/${node.id}`);
        return;
      }
      // Tag abre o editor de cor; clicar de novo no mesmo nó fecha.
      setSelectedTag((current) =>
        current?.id === node.id
          ? null
          : { id: String(node.id), name: node.name, color: node.color }
      );
      setSaveError(false);
    },
    [router]
  );

  /**
   * Troca de cor com atualização otimista: o nó repinta na hora e o PATCH vai
   * atrás. Se o servidor recusar, tudo volta — nada fica mentindo na tela.
   */
  async function pickColor(color: string | null) {
    if (!selectedTag) return;
    const tagId = selectedTag.id;
    const previous = selectedTag.color;

    setSelectedTag((current) => (current ? { ...current, color } : current));
    setSavingColor(true);
    setSaveError(false);

    try {
      const response = await fetch(`/api/tags/${tagId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
      if (!response.ok) throw new Error("PATCH failed");
      onTagColorChange?.(tagId, color);
    } catch {
      setSelectedTag((current) =>
        current?.id === tagId ? { ...current, color: previous } : current
      );
      setSaveError(true);
    } finally {
      setSavingColor(false);
    }
  }

  /* --- Controles de zoom -------------------------------------------------- */

  function zoomBy(factor: number) {
    const current = fgRef.current?.zoom() ?? 1;
    fgRef.current?.zoom(current * factor, 250);
  }

  // A lib enquadra pelas coordenadas dos nós e não sabe do rótulo que
  // desenhamos embaixo de cada um — a folga extra é o espaço desse texto.
  function zoomToFit() {
    fgRef.current?.zoomToFit(400, 72);
  }

  function resetView() {
    fgRef.current?.centerAt(0, 0, 300);
    fgRef.current?.zoom(1, 300);
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-secondary/40 px-6 text-center">
        <span className="text-sm font-medium text-foreground">
          Ainda não há o que desenhar
        </span>
        <span className="max-w-xs text-sm text-muted-foreground">
          O grafo aparece quando as suas notas começam a ganhar tags — a Nexo
          marca cada captura sozinha.
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background">
      <div
        ref={containerRef}
        style={{ cursor: hoveredNode ? "pointer" : "grab" }}
        className="relative"
      >
        {/* O nome de cada nó é desenhado no canvas (ver `drawNode`), então o
            rótulo nativo da lib — um title correndo atrás do mouse — só
            duplicaria a informação. Daí o nodeLabel vazio. */}
        <ForceGraph2D
          ref={fgRef}
          graphData={{ nodes, links: graphLinks }}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintPointerArea}
          linkColor={linkColor}
          linkWidth={linkWidth}
          onNodeClick={handleNodeClick}
          onNodeHover={(node) => setHoveredNode(node as GraphNode | null)}
          onBackgroundClick={() => setSelectedTag(null)}
          onZoom={({ k }) => setZoomK(k)}
          onEngineTick={tuneForces}
          onEngineStop={() => {
            if (fittedRef.current) return;
            fittedRef.current = true;
            zoomToFit();
          }}
          nodeLabel={() => ""}
          width={width}
          height={height}
          cooldownTicks={180}
        />

        {/* Controles de zoom */}
        <div className="absolute top-3 right-3 flex flex-col items-center gap-0.5 rounded-xl border border-border bg-background/90 p-1 backdrop-blur-sm">
          <GraphControlButton label="Aproximar" onClick={() => zoomBy(1.4)}>
            <ZoomIn className="size-4" aria-hidden="true" />
          </GraphControlButton>
          <GraphControlButton label="Afastar" onClick={() => zoomBy(1 / 1.4)}>
            <ZoomOut className="size-4" aria-hidden="true" />
          </GraphControlButton>
          <GraphControlButton label="Ajustar ao conteúdo" onClick={zoomToFit}>
            <Maximize className="size-4" aria-hidden="true" />
          </GraphControlButton>
          <GraphControlButton label="Recentralizar" onClick={resetView}>
            <RotateCcw className="size-4" aria-hidden="true" />
          </GraphControlButton>
          <span className="px-1 pt-0.5 text-[10px] tabular-nums text-subtle-foreground">
            {Math.round(zoomK * 100)}%
          </span>
        </div>

        {/* Detalhe do nó em foco: o rótulo já está no canvas, então aqui vai o
            que ele não cabe — o título inteiro e para onde o clique leva. */}
        {hoveredNode && (
          <div className="pointer-events-none absolute top-3 left-3 max-w-[min(20rem,calc(100%-6rem))] rounded-lg bg-foreground px-2.5 py-1.5 text-xs text-background">
            <span className="block truncate font-medium">
              {hoveredNode.kind === "tag"
                ? `#${hoveredNode.name}`
                : hoveredNode.name.trim() || "Sem título"}
            </span>
            <span className="block opacity-70">
              {hoveredNode.degree === 1
                ? "1 ligação"
                : `${hoveredNode.degree} ligações`}
              {" · "}
              {hoveredNode.kind === "tag" ? "trocar a cor" : "abrir a nota"}
            </span>
          </div>
        )}

        {/* Editor de cor da tag selecionada */}
        {selectedTag && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-xl border border-border bg-background/95 py-2 pr-3 pl-4 shadow-lg backdrop-blur-sm">
            <span className="text-sm font-medium whitespace-nowrap text-foreground">
              #{selectedTag.name}
            </span>
            <span className="h-5 w-px bg-border" aria-hidden="true" />
            <div
              className="flex items-center gap-1.5"
              role="group"
              aria-label="Cor da tag"
            >
              {TAG_PALETTE.map((position) => (
                <button
                  key={position}
                  type="button"
                  disabled={savingColor}
                  onClick={() => pickColor(position)}
                  aria-label={`Cor ${position}`}
                  aria-pressed={selectedTag.color === position}
                  style={{
                    backgroundColor: theme
                      ? theme.colors[`tag-${position}`]
                      : undefined,
                  }}
                  className={cn(
                    "size-6 rounded-full transition-transform duration-100",
                    "hover:scale-110 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:outline-none",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    selectedTag.color === position &&
                      "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                  )}
                />
              ))}
              <button
                type="button"
                disabled={savingColor}
                onClick={() => pickColor(null)}
                aria-label="Cor automática"
                aria-pressed={selectedTag.color === null}
                title="Automática (deriva do nome)"
                className={cn(
                  "flex size-6 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-transform duration-100",
                  "hover:scale-110 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  selectedTag.color === null &&
                    "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                )}
              >
                <RotateCcw className="size-3" aria-hidden="true" />
              </button>
            </div>
            {savingColor && (
              <span className="text-xs text-subtle-foreground">Salvando…</span>
            )}
            {saveError && !savingColor && (
              <span className="text-xs text-error">
                Não foi possível salvar. Tente de novo.
              </span>
            )}
          </div>
        )}
      </div>

      {/* A legenda é rodapé do cartão, não camada sobre o canvas: flutuando
          no canto inferior ela era atravessada pelos nós que a simulação
          levava para lá. Aqui ela tem o seu próprio espaço e o desenho tem o
          dele. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3.5 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-full border-[1.5px] border-muted-foreground"
            aria-hidden="true"
          />
          Nota
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-full bg-tag-3-foreground"
            aria-hidden="true"
          />
          Tag
        </span>
        <span className="text-subtle-foreground">
          Quanto maior o ponto, mais ligações ele tem
        </span>
      </div>
    </div>
  );
}

function GraphControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-100 hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground focus-visible:outline-none"
    >
      {children}
    </button>
  );
}
