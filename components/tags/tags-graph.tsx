"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

import type {
  ForceGraphProps,
  LinkObject,
  NodeObject,
} from "react-force-graph-2d";
import type { TagGraph } from "@/lib/tags/queries";

// A lib de força é pesada (d3 + canvas): só desce quando o modo grafo abre.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-96 items-center justify-center rounded-2xl border border-border bg-secondary/40">
      <span className="text-sm text-muted-foreground">Carregando o grafo…</span>
    </div>
  ),
}) as ComponentType<ForceGraphProps<GraphNodeData, GraphLinkData>>;

interface GraphNodeData {
  kind: "note" | "tag";
  name: string;
  color?: string;
  val: number;
}

interface GraphLinkData {
  source: string;
  target: string;
}

type GraphNode = NodeObject<GraphNodeData>;
type GraphLink = LinkObject<GraphNodeData, GraphLinkData>;

export function TagsGraph({ notes, tags, links }: TagGraph) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [width, setWidth] = useState(800);

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

  // Os nós: notas e tags, cada um com um tamanho proporcional ao grau.
  const { nodes, graphLinks } = useMemo(() => {
    const degree = new Map<string, number>();
    for (const link of links) {
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
    }

    const graphNodes: GraphNode[] = [
      ...notes.map(
        (note): GraphNode => ({
          id: note.id,
          kind: "note",
          name: note.title,
          val: Math.min(3 + (degree.get(note.id) ?? 0), 8),
        })
      ),
      ...tags.map(
        (tag): GraphNode => ({
          id: tag.id,
          kind: "tag",
          name: `#${tag.name}`,
          color: tag.color ?? undefined,
          val: Math.min(4 + (degree.get(tag.id) ?? 0), 10),
        })
      ),
    ];

    return { nodes: graphNodes, graphLinks: links as GraphLink[] };
  }, [notes, tags, links]);

  const nodeColor = useCallback((node: GraphNode) => {
    if (node.kind === "tag" && node.color) {
      // A cor gravada é uma posição da paleta; o token CSS resolve o tom.
      return `var(--color-tag-${node.color})`;
    }
    if (node.kind === "tag") {
      return "var(--color-muted-foreground)";
    }
    return "var(--color-foreground)";
  }, []);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.kind === "note" && typeof node.id === "string") {
        router.push(`/nota/${node.id}`);
      }
    },
    [router]
  );

  if (nodes.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-2xl border border-border bg-secondary/40">
        <span className="text-sm text-muted-foreground">
          Nenhuma tag ou nota para desenhar.
        </span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-2xl border border-border bg-background"
    >
      <ForceGraph2D
        graphData={{ nodes, links: graphLinks }}
        nodeLabel="name"
        nodeColor={nodeColor}
        nodeRelSize={4}
        linkColor={() => "var(--color-border)"}
        linkWidth={1}
        onNodeClick={handleNodeClick}
        onNodeHover={(node) => setHoveredNode(node as GraphNode | null)}
        width={width}
        height={500}
        cooldownTicks={100}
      />

      {/* Legenda flutuante */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-lg bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-foreground" />
          Nota
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground" />
          Tag
        </span>
      </div>

      {/* Tooltip do nó em hover */}
      {hoveredNode && (
        <div className="pointer-events-none absolute top-3 left-3 rounded-lg bg-foreground px-2.5 py-1 text-xs text-background">
          {hoveredNode.name}
        </div>
      )}
    </div>
  );
}
