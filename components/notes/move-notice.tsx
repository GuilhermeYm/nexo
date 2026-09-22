"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export interface MoveNoticeState {
  phase: "moving" | "done";
  message: string;
}

/**
 * Aviso transitório de "movendo nota" do Kanban.
 *
 * Neutro de propósito: o banner de erro (`notice` em `notes-view.tsx`) é o
 * único em vermelho, e este é informativo — a mesma pílula do aviso
 * transitório do dashboard (`dashboard-shell.tsx`). Duas fases no mesmo
 * elemento: "Movendo…" enquanto o PUT está em voo e a confirmação breve
 * depois, que some sozinha (o timer mora em `notes-view.tsx`).
 *
 * **Flutua, não empurra.** No fluxo da página, o aviso entrava acima dos
 * filtros e descia o quadro inteiro 60px no instante do drop — e subia de
 * novo dois segundos depois, com o olho da pessoa no card. Fixo no rodapé,
 * ele também continua à vista quando o Kanban está rolado para baixo, que
 * no celular é o caso de sempre.
 *
 * **A região viva fica sempre montada.** `role="status"` que já nasce com o
 * texto costuma não ser anunciado; só a troca de conteúdo dentro de uma
 * região existente é. Por isso quem monta **não** passa `key`: a fase troca
 * o ícone e o texto dentro da mesma pílula.
 */
export function MoveNotice({ state }: { state: MoveNoticeState | null }) {
  // Segura a última frase durante o fade de saída: sem isso, o texto sumia
  // no primeiro quadro e o que desbotava era uma pílula vazia.
  const [last, setLast] = useState(state);
  if (state && state !== last) setLast(state);
  const shown = state ?? last;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <div
        className={cn(
          "flex max-w-[min(38rem,100%)] items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm leading-6 text-foreground",
          "shadow-[0_8px_28px_-10px] shadow-black/35",
          "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          state ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        )}
      >
        {/* Fora do estado, a frase ainda desbota diante do olho, mas sai da
            árvore de acessibilidade: não fica um "Nota movida." órfão para
            quem navega pelo leitor de tela. */}
        <span className="flex min-w-0 items-center gap-2" aria-hidden={state ? undefined : true}>
          {shown &&
            (shown.phase === "moving" ? (
              <LoaderCircle
                className="size-4 shrink-0 animate-spin text-subtle-foreground motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
            ))}
          <span className="min-w-0 truncate">{shown?.message}</span>
        </span>
      </div>
    </div>
  );
}
