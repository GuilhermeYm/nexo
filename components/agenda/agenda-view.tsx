"use client";

import { ArrowLeft, CalendarDays, ChevronDown, ListTodo, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemLabel,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useLiveResource } from "@/hooks/use-live-resource";
import { useLocalDay } from "@/hooks/use-local-day";
import { dayLabel } from "@/lib/agenda/day";
import type { AgendaDay, AgendaNote } from "@/lib/agenda/queries";
import { cn } from "@/lib/utils";

/**
 * A sala da Agenda.
 *
 * Uma lista de tarefas por dia, e cada lista é **uma nota** — com busca,
 * tags, sincronização e a possibilidade de ser aberta na lousa ou no editor
 * de rota própria. Ver docs/AGENDA.md.
 *
 * ## O dia é decidido aqui, no cliente, e isso não é preguiça
 *
 * O Server Component não conhece o fuso do navegador, e o truque do
 * `renderedAt` que as outras salas usam **não serve**: ele funciona para
 * tempo relativo ("há 3 minutos") porque `agora - criado` dá o mesmo número
 * em qualquer fuso, e uma data absoluta local não tem essa propriedade.
 * Derivar o dia no servidor daria UTC lá e UTC−3 aqui — mismatch de
 * hidratação, e com o dia errado.
 *
 * Por isso o servidor manda uma **faixa** de dias (calculada em UTC, com
 * margem para cobrir de UTC−12 a UTC+14) e quem escolhe qual deles é "hoje" é
 * este componente, depois da montagem.
 */

/** O editor só desce quando a sala abre — o ProseMirror é a peça mais pesada. */
const DayEditor = dynamic(
  () => import("@/components/agenda/day-editor").then((m) => m.DayEditor),
  {
    ssr: false,
    loading: () => (
      <div className="h-24 animate-pulse rounded-lg bg-secondary/60" />
    ),
  }
);

const TABLES = ["notes"] as const;

interface AgendaViewProps {
  /** A faixa já lida no servidor, para a sala pintar no primeiro paint. */
  initial: AgendaDay[];
  /** A lista de hoje, quando ela já existe. Vem com o documento. */
  initialToday: AgendaNote | null;
  /** Os limites da faixa, calculados em UTC no servidor. Estáveis. */
  from: string;
  to: string;
}

export function AgendaView({ initial, initialToday, from, to }: AgendaViewProps) {
  const { items: days, refresh } = useLiveResource<AgendaDay>({
    endpoint: `/api/agenda?from=${from}&to=${to}`,
    field: "days",
    initial,
    tables: [...TABLES],
  });

  /**
   * O dia local. Nulo no primeiro render — servidor e cliente concordam em
   * nulo, e é isso que elimina a divergência de hidratação. O hook também
   * cuida da virada de meia-noite com a aba aberta.
   */
  const today = useLocalDay();

  /** O contador de hoje, repintado na hora pelo editor. */
  const [liveTally, setLiveTally] = useState<{ total: number; done: number } | null>(
    null
  );
  /** O id que a criação preguiçosa devolveu, antes da rebusca chegar. */
  const [createdId, setCreatedId] = useState<string | null>(null);

  const todayRow = useMemo(
    () => (today ? days.find((day) => day.date === today) ?? null : null),
    [days, today]
  );
  const past = useMemo(
    () => (today ? days.filter((day) => day.date !== today) : days),
    [days, today]
  );

  const onCreated = useCallback(
    (id: string) => {
      setCreatedId(id);
      void refresh();
    },
    [refresh]
  );

  /** O aviso de uma exclusão que falhou. Some na próxima tentativa. */
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * Apaga a lista de um dia anterior — nunca a de hoje, porque só `PastDay`
   * chama isto, e `past` já exclui `today` por construção.
   *
   * É `DELETE /api/notes/[id]`, a mesma rota de qualquer nota: exclusão
   * lógica (`status = 'deleted'`), que **libera o dia** — o índice único de
   * `notes_user_task_date_key` ignora notas nesse estado. Ver docs/AGENDA.md.
   */
  const deleteDay = useCallback(
    async (noteId: string) => {
      setDeleteError(null);
      try {
        const response = await fetch(`/api/notes/${noteId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          setDeleteError("Não foi possível excluir a lista do dia.");
          return;
        }
      } catch {
        setDeleteError("Sem conexão. A lista não foi excluída.");
      } finally {
        void refresh();
      }
    },
    [refresh]
  );

  // `initialToday` só vale enquanto a sala está olhando o dia que o servidor
  // mandou. Trocado o dia (meia-noite, ou um fuso à frente da faixa), o
  // documento de partida deixa de existir e o editor recomeça no andaime.
  const todayDoc =
    today && initialToday?.date === today ? initialToday.contentRich : null;
  const todayId = todayRow?.id ?? createdId ?? null;
  const todayTally = liveTally ?? {
    total: todayRow?.tasksTotal ?? 0,
    done: todayRow?.tasksDone ?? 0,
  };

  return (
    <div className="flex min-h-dvh bg-secondary p-3">
      {/* A mesma "janela" de Tags, Entrada e Configurações. */}
      <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-background">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10 sm:py-14">
          <Link
            href="/dashboard"
            className="flex w-fit items-center gap-1.5 rounded-lg py-1 pr-2 text-sm text-subtle-foreground transition-colors duration-150 hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Início
          </Link>

          <div className="mt-6 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground"
            >
              <CalendarDays className="size-[18px]" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
              Agenda
            </h1>
          </div>

          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
            Um dia, uma lista. Cada lista é uma nota da sua conta — dá para
            buscar, marcar com tags e abrir na lousa como qualquer outra.
          </p>

          {/* ---------------------------------------------------------- */}
          {/* Hoje                                                        */}
          {/* ---------------------------------------------------------- */}
          <section className="mt-7 overflow-hidden rounded-2xl border border-border">
            <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <h2 className="text-sm font-semibold text-foreground">
                  {today ? dayLabel(today, today) : "Hoje"}
                </h2>
                {today && (
                  <span className="truncate text-xs text-subtle-foreground">
                    {longDate(today)}
                  </span>
                )}
              </div>
              <TallyChip total={todayTally.total} done={todayTally.done} />
            </header>

            <div className="px-4 py-3">
              {today ? (
                <DayEditor
                  key={today}
                  date={today}
                  noteId={todayId}
                  initialDoc={todayDoc}
                  onTally={setLiveTally}
                  onCreated={onCreated}
                />
              ) : (
                // Antes da montagem não dá para saber que dia é hoje sem
                // arriscar renderizar o dia errado. Ver o cabeçalho do arquivo.
                <div className="h-24 animate-pulse rounded-lg bg-secondary/60" />
              )}
            </div>

            {todayId && (
              <footer className="border-t border-border px-4 py-2">
                <Link
                  href={`/nota/${todayId}`}
                  className="text-xs text-subtle-foreground underline decoration-border underline-offset-4 transition-colors duration-150 hover:text-foreground"
                >
                  Abrir como nota
                </Link>
              </footer>
            )}
          </section>

          {/* ---------------------------------------------------------- */}
          {/* Os dias anteriores                                          */}
          {/* ---------------------------------------------------------- */}
          <section className="mt-6 flex flex-col overflow-hidden rounded-2xl border border-border">
            <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
              {/*
                "Outros dias", e não "Dias anteriores": a rota aceita data
                futura (dentro da faixa de ±370 dias), então um dia planejado
                para amanhã cai aqui — e um cabeçalho dizendo "anteriores"
                sobre a lista de amanhã seria simplesmente falso. A ordem é
                por data decrescente, então o futuro aparece no topo.
              */}
              <h2 className="text-sm font-semibold text-foreground">
                Outros dias
              </h2>
              {past.length > 0 && (
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {past.length}
                </span>
              )}
            </header>

            {past.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-8 py-10 text-center">
                <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-subtle-foreground">
                  <ListTodo className="size-5" aria-hidden="true" />
                </span>
                <div className="max-w-[34ch]">
                  <p className="text-sm font-medium text-foreground">
                    Só hoje, por enquanto
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    As listas dos outros dias ficam aqui, da mais recente para
                    a mais antiga. Nada é apagado por tempo.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {past.map((day) => (
                  <PastDay
                    key={day.id}
                    day={day}
                    today={today}
                    onDelete={() => deleteDay(day.id)}
                  />
                ))}
              </ul>
            )}

            {deleteError && (
              <p
                role="status"
                className="border-t border-border px-4 py-2.5 text-xs leading-relaxed text-error"
              >
                {deleteError}
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

/**
 * Um dia anterior.
 *
 * Clicar expande no lugar, e é de propósito: riscar algo que ficou para trás
 * é o gesto que a sala existe para permitir, e mandar a pessoa para outra
 * rota para marcar uma caixa seria caro demais para o que é. Só o expandido
 * monta editor.
 *
 * Excluir a lista é botão direito (ou toque longo), o mesmo gesto de
 * Recentes e do editor de nota — nunca aparece para o dia de hoje porque
 * `today` já foi filtrado de `past` antes de chegar aqui.
 */
function PastDay({
  day,
  today,
  onDelete,
}: {
  day: AgendaDay;
  today: string | null;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<unknown | null>(null);
  const [loaded, setLoaded] = useState(false);
  /**
   * O contador local, enquanto a pessoa mexe nesta linha.
   *
   * Nulo significa "use o número do servidor". Não é um efeito sincronizando
   * prop com estado — é uma sobreposição que só existe depois de a pessoa
   * marcar alguma coisa aqui, e que morre quando a linha fecha.
   */
  const [override, setOverride] = useState<{ total: number; done: number } | null>(
    null
  );
  const tally = override ?? { total: day.tasksTotal, done: day.tasksDone };
  // Derivado, não estado: enquanto a linha está aberta e o documento não
  // chegou, ela está carregando. Um `setLoading(true)` no corpo do efeito
  // seria render em cascata para dizer o que já dá para calcular.
  const loading = open && !loaded;

  // O documento só é buscado quando a linha abre — a faixa não o traz, para
  // trinta dias não custarem trinta documentos.
  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;
    void fetch(`/api/agenda/${day.date}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { note?: { contentRich?: unknown } } | null) => {
        if (!alive) return;
        setDoc(body?.note?.contentRich ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [open, loaded, day.date]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li>
          <button
            type="button"
            onClick={() =>
              setOpen((value) => {
                // Fechar solta a sobreposição: da próxima vez a linha volta a
                // mostrar o número do servidor, que a essa altura já foi
                // gravado.
                if (value) setOverride(null);
                return !value;
              })
            }
            aria-expanded={open}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-secondary/50"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-subtle-foreground transition-transform duration-150 motion-reduce:transition-none",
                open && "rotate-180"
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {today ? dayLabel(day.date, today) : day.date}
              </span>
              <span className="mt-0.5 block truncate text-xs text-subtle-foreground">
                {longDate(day.date)}
              </span>
            </span>
            <TallyChip total={tally.total} done={tally.done} />
          </button>

          {open && (
            <div className="px-4 pb-3 pl-11">
              {loading ? (
                <div className="h-20 animate-pulse rounded-lg bg-secondary/60" />
              ) : (
                <DayEditor
                  date={day.date}
                  noteId={day.id}
                  initialDoc={doc}
                  onTally={setOverride}
                />
              )}
              <Link
                href={`/nota/${day.id}`}
                className="mt-1 inline-block text-xs text-subtle-foreground underline decoration-border underline-offset-4 transition-colors duration-150 hover:text-foreground"
              >
                Abrir como nota
              </Link>
            </div>
          )}
        </li>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          destructive
          confirmLabel="Excluir para valer"
          onSelect={onDelete}
        >
          <Trash2 className="mt-0.5 size-4 shrink-0" />
          <ContextMenuItemLabel
            label="Excluir lista do dia"
            hint="Libera o dia para uma nova lista. Sai da Agenda e de Recentes."
          />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * "5 de 7", com uma barra fina.
 *
 * Some quando não há caixa nenhuma: "0 de 0" é ruído, e um dia escrito em
 * prosa é um uso legítimo da sala — a lista do dia é uma nota, não um
 * formulário.
 */
function TallyChip({ total, done }: { total: number; done: number }) {
  if (total === 0) return null;
  const complete = done === total;

  return (
    <span className="flex shrink-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="h-1 w-10 overflow-hidden rounded-full bg-secondary"
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none",
            complete ? "bg-tag-3-foreground" : "bg-subtle-foreground"
          )}
          style={{ width: `${Math.round((done / total) * 100)}%` }}
        />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {done} de {total}
      </span>
    </span>
  );
}

/** "sábado, 30 de agosto" — por extenso, em UTC. Ver `lib/agenda/day.ts`. */
function longDate(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
