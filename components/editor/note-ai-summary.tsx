"use client";

import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatAbsolute, formatRelative } from "@/lib/dashboard/format";
import type { NoteAiView } from "@/lib/notes/ai-view";
import { createClient } from "@/lib/supabase/client";
import { authorizeRealtime } from "@/lib/supabase/realtime";
import { cn } from "@/lib/utils";

/**
 * O resumo que a Nexo escreveu, no canto de baixo da nota.
 *
 * **Discreto, não apagado.** Texto pequeno na cor secundária — nunca na cor
 * do fundo, que reprovaria o contraste e esconderia de quem mais precisa
 * dele. O rótulo "Resumo da Nexo" é obrigatório: o que a IA escreveu é
 * sempre identificável (princípio do produto).
 *
 * **Vivo.** Assina `note_ai_state` desta nota e, a cada evento, rebusca
 * `/api/notes/[id]/ai` — o evento é o sino, a rota é o retrato. É a rota que
 * sabe se o resumo ficou velho: os hashes não chegam ao cliente.
 *
 * Fica fora do PDF exportado: o documento é da pessoa.
 */
export function NoteAiSummary({
  noteId,
  initial,
}: {
  noteId: string;
  initial: NoteAiView | null;
}) {
  const [view, setView] = useState<NoteAiView | null>(initial);
  // O que o leitor de tela ouve: só a mudança de estado, nunca o "há 3 min"
  // que se reescreve a cada minuto enquanto a pessoa digita.
  const [announcement, setAnnouncement] = useState("");
  const lastState = useRef(initial?.state ?? null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef<AbortController | null>(null);
  const burst = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const response = await fetch(`/api/notes/${noteId}/ai`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as { ai: NoteAiView | null };
      const next = body.ai?.state ?? null;
      if (next !== lastState.current) {
        if (next === "running") setAnnouncement("A Nexo está lendo esta nota.");
        else if (lastState.current === "running" && body.ai?.summary) {
          setAnnouncement("Resumo da Nexo atualizado.");
        }
        lastState.current = next;
      }
      setView(body.ai);
      setNow(Date.now());
    } catch {
      // Abort ou rede fora: fica o último retrato bom.
    }
  }, [noteId]);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    function schedule() {
      if (burst.current) clearTimeout(burst.current);
      burst.current = setTimeout(() => void refresh(), 250);
    }

    // Token no socket antes de assinar, senão o canal fica inscrito e mudo
    // para sempre. Ver docs/REALTIME.md.
    void (async () => {
      await authorizeRealtime(supabase);
      if (cancelled) return;
      channel = supabase
        .channel(`note-ai:${noteId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "note_ai_state",
            filter: `note_id=eq.${noteId}`,
          },
          schedule
        )
        .subscribe();
    })();

    function onVisible() {
      if (document.visibilityState === "visible") schedule();
    }
    document.addEventListener("visibilitychange", onVisible);

    // "Lido há 3 min" envelhece com a página aberta.
    const tick = setInterval(() => setNow(Date.now()), 60_000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(tick);
      if (burst.current) clearTimeout(burst.current);
      inFlight.current?.abort();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [noteId, refresh]);

  const reading = view?.state === "running";
  const status = (
    <span role="status" className="sr-only">
      {announcement}
    </span>
  );
  if (!view || (!view.summary && !reading)) return status;

  return (
    <section aria-label="Resumo da Nexo" className="max-w-md print:hidden">
      {status}
      <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-medium text-subtle-foreground">
        <Sparkles className="size-3 shrink-0" aria-hidden="true" />
        <span>Resumo da Nexo</span>
        {reading ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-subtle-foreground animate-pulse motion-reduce:animate-none"
              />
              lendo agora
            </span>
          </>
        ) : view.stale ? (
          <>
            <span aria-hidden="true">·</span>
            <span>de uma versão anterior</span>
          </>
        ) : view.readAt ? (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={view.readAt} title={formatAbsolute(view.readAt)}>
              {formatRelative(view.readAt, now)}
            </time>
          </>
        ) : null}
      </p>

      {view.summary ? (
        <p
          className={cn(
            // Menor que o texto da nota em qualquer zoom: o documento é da
            // pessoa, o resumo é nota de rodapé.
            "mt-1 text-xs leading-relaxed text-pretty text-muted-foreground",
            view.stale && "italic"
          )}
        >
          {view.summary}
        </p>
      ) : (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          A Nexo está lendo esta nota. O resumo aparece aqui.
        </p>
      )}
    </section>
  );
}
