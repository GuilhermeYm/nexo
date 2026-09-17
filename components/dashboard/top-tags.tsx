"use client";

import { ArrowUpRight, Hash } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { TAG_DOT_CLASS, tagTone } from "@/lib/tags/palette";
import type { TopTag } from "@/lib/dashboard/queries";

/**
 * Um atalho de reencontro, não um segundo inventário de tags.
 *
 * O dashboard mostra só os agrupamentos que de fato atravessam mais notas; a
 * página de Tags continua sendo o lugar para buscar, editar e explorar tudo.
 */
export function TopTags({
  tags,
  entranceDelay,
}: {
  tags: TopTag[];
  entranceDelay?: string;
}) {
  // O primeiro retrato vem pronto do servidor e não precisa de coreografia.
  // Depois, uma nova captura pode mudar o ranking; aí sim marcamos apenas as
  // etiquetas que subiram, desceram ou entraram, para a mudança não passar
  // despercebida entre os outros itens estáveis.
  const previousRanking = useRef(
    new Map(tags.map((tag, position) => [tag.id, { position, noteCount: tag.noteCount }]))
  );
  const [changedIds, setChangedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  useEffect(() => {
    const nextRanking = new Map(
      tags.map((tag, position) => [tag.id, { position, noteCount: tag.noteCount }])
    );
    const changed = tags
      .filter((tag, position) => {
        const previous = previousRanking.current.get(tag.id);
        return (
          !previous ||
          previous.position !== position ||
          previous.noteCount !== tag.noteCount
        );
      })
      .map((tag) => tag.id);

    previousRanking.current = nextRanking;
    if (changed.length === 0) return;

    setChangedIds(new Set(changed));
    const timer = window.setTimeout(() => setChangedIds(new Set()), 1_100);
    return () => window.clearTimeout(timer);
  }, [tags]);

  return (
    <section
      aria-labelledby="top-tags-title"
      data-dashboard-enter=""
      className="mt-4 animate-dashboard-enter overflow-hidden rounded-2xl border border-border bg-background motion-reduce:animate-none"
      style={{ animationDelay: entranceDelay }}
    >
      <header className="flex min-h-12 items-center gap-2.5 border-b border-border px-4 py-2">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-subtle-foreground"
        >
          <Hash className="size-4" />
        </span>
        <div className="min-w-0">
          <h2
            id="top-tags-title"
            className="text-sm font-semibold text-foreground"
          >
            Tags mais usadas
          </h2>
          <p className="text-xs text-subtle-foreground">
            Em todas as suas notas
          </p>
        </div>
        <Link
          href="/dashboard/tags"
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground pointer-coarse:py-1.5"
        >
          Ver todas
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </header>

      {tags.length === 0 ? (
        <div className="px-4 py-5 text-sm leading-relaxed text-muted-foreground">
          Quando uma nota receber uma tag, ela aparece aqui para facilitar os
          seus reencontros.
        </div>
      ) : (
        <ol className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3">
          {tags.map((tag, index) => (
            <li
              key={tag.id}
              data-ranking-change={changedIds.has(tag.id) ? "" : undefined}
              className={`relative min-w-0 ${
                changedIds.has(tag.id)
                  ? "animate-ranking-change motion-reduce:animate-none"
                  : "animate-dashboard-enter motion-reduce:animate-none"
              }`}
              style={
                changedIds.has(tag.id)
                  ? undefined
                  : { animationDelay: `${255 + Math.min(index, 5) * 40}ms` }
              }
            >
              {changedIds.has(tag.id) && (
                <span
                  aria-hidden="true"
                  data-ranking-flash=""
                  className="pointer-events-none absolute inset-0 animate-ranking-flash bg-accent/10 motion-reduce:hidden"
                />
              )}
              <Link
                href="/dashboard/tags"
                aria-label={`Ver a tag ${tag.name}, usada em ${tag.noteCount} ${tag.noteCount === 1 ? "nota" : "notas"}`}
                className="group relative flex min-h-14 items-center gap-2.5 px-4 py-3 transition-[background-color,transform] duration-150 hover:bg-secondary/70 hover:translate-x-0.5 motion-reduce:hover:translate-x-0"
              >
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full transition-transform duration-150 group-hover:scale-125 motion-reduce:group-hover:scale-100 ${TAG_DOT_CLASS[tagTone(tag)]}`}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  #{tag.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-subtle-foreground group-hover:text-muted-foreground">
                  {tag.noteCount} {tag.noteCount === 1 ? "nota" : "notas"}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
