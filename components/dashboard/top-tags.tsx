"use client";

import { ArrowUpRight } from "lucide-react";
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
    // Uma linha de chips, e não mais uma grade de cartões: a grade tinha a
    // mesma moldura dos painéis e passava de 600px no celular, empurrando
    // Recentes para longe. É um atalho — cabe numa frase.
    <section
      aria-labelledby="top-tags-title"
      data-dashboard-enter=""
      className="mt-10 animate-dashboard-enter motion-reduce:animate-none"
      style={{ animationDelay: entranceDelay }}
    >
      <header className="flex items-baseline gap-3">
        <h2 id="top-tags-title" className="text-sm font-semibold text-foreground">
          Tags mais usadas
        </h2>
        <Link
          href="/dashboard/tags"
          className="-my-1 ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-foreground pointer-coarse:py-2"
        >
          Ver todas
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </header>

      {tags.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Quando uma nota receber uma tag, ela aparece aqui para facilitar os
          seus reencontros.
        </p>
      ) : (
        <ol className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag, index) => (
            <li
              key={tag.id}
              data-ranking-change={changedIds.has(tag.id) ? "" : undefined}
              className={`relative min-w-0 max-w-full overflow-hidden rounded-full ${
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
              {/* Abre a própria tag, não a lista de todas: é o mesmo destino
                  que a busca da barra usa para uma tag. */}
              <Link
                href={`/dashboard/tags?tag=${encodeURIComponent(tag.id)}`}
                aria-label={`Ver a tag ${tag.name}, usada em ${tag.noteCount} ${tag.noteCount === 1 ? "nota" : "notas"}`}
                className="group flex h-9 max-w-full items-center gap-2 rounded-full border border-border bg-background pr-3 pl-2.5 transition-colors duration-150 hover:border-subtle-foreground/60 pointer-coarse:h-11"
              >
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full ${TAG_DOT_CLASS[tagTone(tag)]}`}
                />
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  #{tag.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-subtle-foreground group-hover:text-muted-foreground">
                  {tag.noteCount}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
