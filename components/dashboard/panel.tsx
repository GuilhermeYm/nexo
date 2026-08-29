"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import type { LiveStatus } from "@/hooks/use-live-resource";
import { cn } from "@/lib/utils";

/**
 * A moldura compartilhada de Tarefas e Recentes.
 *
 * Os dois painéis precisam ter exatamente a mesma altura, o mesmo cabeçalho e
 * o mesmo comportamento de rolagem — se um deles desenhar a borda sozinho, os
 * dois deixam de parecer o mesmo objeto. Por isso a moldura é um componente e
 * não uma classe copiada.
 */
export function Panel({
  title,
  count,
  status,
  isRefreshing,
  action,
  children,
}: {
  title: string;
  count?: number;
  status?: LiveStatus;
  isRefreshing?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex h-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>

        {typeof count === "number" && count > 0 && (
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        )}

        {/* O ponto de sincronização é diagnóstico, não decoração: ele só muda
            de cor quando o estado da conexão muda de verdade. */}
        {status && (
          <span
            className="ml-auto flex items-center gap-1.5"
            title={
              status === "live"
                ? "Sincronizando em tempo real"
                : status === "connecting"
                  ? "Conectando…"
                  : "Sem conexão em tempo real — os dados podem estar atrasados"
            }
          >
            {isRefreshing ? (
              <LoaderCircle
                className="size-3 animate-spin text-subtle-foreground motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full transition-colors duration-200",
                  status === "live"
                    ? "bg-tag-3-foreground"
                    : status === "connecting"
                      ? "bg-tag-1-foreground"
                      : "bg-subtle-foreground"
                )}
              />
            )}
            <span className="sr-only">
              {status === "live"
                ? "Sincronizando em tempo real"
                : status === "connecting"
                  ? "Conectando"
                  : "Sem conexão em tempo real"}
            </span>
          </span>
        )}

        {action && <span className={status ? "" : "ml-auto"}>{action}</span>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

/**
 * Estado vazio que ensina a interface em vez de anunciar a ausência.
 * O texto diz o que fazer para a lista deixar de estar vazia.
 */
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-subtle-foreground">
        {icon}
      </span>
      <div className="max-w-[34ch]">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

/** Esqueleto de linha — usado no lugar de spinner no meio do conteúdo. */
export function RowSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul aria-hidden="true" className="divide-y divide-border">
      {Array.from({ length: rows }, (_, row) => (
        <li key={row} className="flex items-start gap-3 px-4 py-3.5">
          <span className="mt-0.5 size-4 shrink-0 rounded bg-secondary" />
          <span className="flex-1 space-y-2">
            <span
              className="block h-3 animate-pulse rounded bg-secondary motion-reduce:animate-none"
              style={{ width: `${72 - row * 9}%` }}
            />
            <span
              className="block h-2.5 animate-pulse rounded bg-secondary motion-reduce:animate-none"
              style={{ width: `${48 - row * 7}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
