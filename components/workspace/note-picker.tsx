"use client";

import { FileText, Paperclip, Search, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  NOTE_TYPE_LABEL,
  NoteTypeIcon,
} from "@/components/dashboard/note-type-icon";
import { storedChipClass } from "@/lib/tags/palette";
import type {
  BoardNoteTag,
  OpenableAttachment,
  OpenableNote,
} from "@/lib/workspace/queries";
import { cn } from "@/lib/utils";

/**
 * "Trazer da conta" — o painel que abre na lousa qualquer coisa já guardada.
 *
 * É a peça que cumpre a promessa central do workspace: o que a pessoa
 * capturou em qualquer lugar do sistema pode ser posto aqui.
 *
 * Duas listas, e a separação não é arrumação: uma **nota** é o que a Nexo
 * escreveu sobre o material — título, resumo, tipo, tags —, e um **arquivo**
 * é o material em si. São coisas diferentes, abrem janelas diferentes, e
 * misturá-las numa lista só obrigaria a pessoa a adivinhar qual das duas ela
 * está prestes a abrir.
 */

type Tab = "notes" | "files";

interface NotePickerProps {
  workspaceId: string;
  open: boolean;
  /**
   * As notas já abertas na lousa.
   *
   * A rota já as exclui, mas a lista renderizada é a resposta anterior até a
   * nova chegar — e nesse intervalo a pessoa consegue clicar numa nota que o
   * índice único vai recusar. Filtrar aqui também torna a exclusão imediata,
   * em vez de depender de uma requisição terminar.
   */
  openNoteIds: Set<string>;
  onClose: () => void;
  onPick: (note: OpenableNote) => void;
  onPickAttachment: (attachment: OpenableAttachment) => void;
}

export function NotePicker({
  workspaceId,
  open,
  openNoteIds,
  onClose,
  onPick,
  onPickAttachment,
}: NotePickerProps) {
  const [tab, setTab] = useState<Tab>("notes");
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<OpenableNote[]>([]);
  const [files, setFiles] = useState<OpenableAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    // `preventScroll` porque o campo ainda está fora da tela quando isto
    // roda: a transição de entrada leva 300ms, e o comportamento padrão do
    // `focus()` é rolar o que for preciso para trazer o campo à vista. Numa
    // superfície com recorte, "o que for preciso" era a lousa inteira.
    if (open) searchRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Escapar fecha: toda sobreposição precisa de saída pelo teclado.
  useEffect(() => {
    if (!open) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    // Enquanto a pessoa digita nada sai; a busca espera ela parar.
    const timer = setTimeout(async () => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      // Zerado aqui e não no corpo do efeito: trocar de aba não deve piscar
      // o texto de "nada encontrado" da aba anterior antes de a resposta
      // nova chegar.
      setLoaded(false);
      setLoading(true);
      try {
        const url = new URL(
          `/api/workspaces/${workspaceId}/${tab === "notes" ? "notes" : "attachments"}`,
          window.location.origin
        );
        if (query.trim()) url.searchParams.set("q", query.trim());

        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;

        const body = await response.json();
        if (tab === "notes" && Array.isArray(body.notes)) setNotes(body.notes);
        if (tab === "files" && Array.isArray(body.attachments)) {
          setFiles(body.attachments);
        }
        setLoaded(true);
      } catch {
        // Abort ou rede fora: a lista mantém o último resultado bom.
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setLoading(false);
        }
      }
    }, query ? 220 : 0);

    return () => clearTimeout(timer);
  }, [open, query, workspaceId, tab]);

  const visibleNotes = notes.filter((note) => !openNoteIds.has(note.id));
  const rowCount = tab === "notes" ? visibleNotes.length : files.length;

  /**
   * A resposta ainda não chegou e não há nada de antes para mostrar.
   *
   * A condição olha a contagem, e não só `loading`: trocar de aba e voltar
   * cai numa lista que já está em memória, e substituí-la por "buscando" a
   * cada ida e volta seria piscar à toa. Vale o mesmo enquanto se digita na
   * busca — a lista anterior fica em pé, esmaecida, até a nova chegar. É a
   * diferença entre uma lista que responde e uma que some.
   */
  const searching = loading && rowCount === 0;
  const isEmpty = rowCount === 0 && loaded && !loading;

  return (
    <>
      {/* O véu.

          Ele resolve dois problemas de uma vez. Diz qual das duas camadas
          está no comando — sem ele a tela mostrava a lousa e o painel lado
          a lado, sem hierarquia nenhuma — e devolve o gesto que todo mundo
          tenta primeiro: clicar fora para sair. O botão de fechar continua
          ali, e o Esc também; ninguém deveria precisar mirar num alvo de
          32px no canto da tela para desistir de uma escolha.

          Ele cobre o plano, não o cabeçalho: a barra de ferramentas segue
          alcançável, porque trocar de ideia e criar um post-it é uma ação
          só, não duas. */}
      <div
        aria-hidden="true"
        onPointerDown={onClose}
        className={cn(
          "absolute inset-0 z-20 bg-foreground/10 transition-opacity duration-300 ease-out motion-reduce:transition-none",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      <aside
        aria-label="Trazer da conta"
        inert={!open}
        className={cn(
          "absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-border bg-background transition-transform duration-300 ease-out motion-reduce:transition-none lg:max-w-sm",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">Trazer da conta</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Qualquer coisa sua, de qualquer workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Fechar o painel — Esc"
            className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:size-11"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Fechar painel</span>
          </button>
        </header>

        <div
          role="group"
          aria-label="O que trazer"
          className="mx-4 mt-3 flex shrink-0 items-center gap-1 rounded-xl border border-border bg-secondary p-1"
        >
          <TabButton
            active={tab === "notes"}
            onClick={() => setTab("notes")}
            icon={<FileText className="size-3.5" aria-hidden="true" />}
          >
            Notas
          </TabButton>
          <TabButton
            active={tab === "files"}
            onClick={() => setTab("files")}
            icon={<Paperclip className="size-3.5" aria-hidden="true" />}
          >
            Arquivos
          </TabButton>
        </div>

        <div className="shrink-0 px-4 pt-3 pb-2">
          <div className="flex h-10 items-center gap-2 rounded-xl border border-border bg-secondary px-3 focus-within:border-subtle-foreground">
            <Search
              className="size-4 shrink-0 text-subtle-foreground"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                tab === "notes" ? "Buscar nas suas notas" : "Buscar nos arquivos"
              }
              aria-label={
                tab === "notes" ? "Buscar nas suas notas" : "Buscar nos arquivos"
              }
              data-focus-ring="container"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
            />
          </div>
        </div>

        {/* `scrollbar-gutter: stable` reserva a faixa da barra de rolagem
            desde sempre.

            Sem isso a lista nasce sem barra — enquanto a busca não volta não
            há linha nenhuma — e ganha uma quando as notas chegam. A barra
            deste projeto tem 10px de largura (ver `globals.css`), então
            **todo o conteúdo pulava 10px para a esquerda no instante em que a
            lista carregava**, abrindo uma folga do lado direito que não
            estava lá um segundo antes. Reservada a faixa, a lista nunca se
            mexe: ela abre onde vai ficar. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-gutter:stable]">
          {searching ? (
            <p
              aria-live="polite"
              className="px-1 pt-6 text-sm leading-relaxed text-muted-foreground"
            >
              <span className="inline-block animate-pulse motion-reduce:animate-none">
                {tab === "notes"
                  ? "Buscando nas suas notas…"
                  : "Buscando nos seus arquivos…"}
              </span>
            </p>
          ) : isEmpty ? (
            <p className="px-1 pt-6 text-sm leading-relaxed text-muted-foreground">
              {query.trim()
                ? `Nada encontrado para "${query.trim()}".`
                : tab === "notes"
                  ? "Tudo o que você já guardou está aberto nesta lousa. Capture algo novo pelo dashboard, ou crie uma nota aqui mesmo."
                  : "Nenhum arquivo disponível. Envie um pela barra de comando do dashboard."}
            </p>
          ) : tab === "notes" ? (
            <ul
              className={cn(
                "flex flex-col gap-0.5 transition-opacity duration-150 motion-reduce:transition-none",
                loading && "opacity-60"
              )}
            >
              {visibleNotes.map((note) => (
                <li key={note.id}>
                  <PickerRow
                    icon={
                      <NoteTypeIcon
                        type={note.type}
                        className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
                      />
                    }
                    title={note.title}
                    excerpt={note.excerpt}
                    meta={NOTE_TYPE_LABEL[note.type] ?? "Nota"}
                    tags={note.tags}
                    badge={
                      note.source === "ai" ? (
                        <Sparkles
                          className="size-3 shrink-0 text-subtle-foreground"
                          aria-label="Criada pela IA"
                        />
                      ) : null
                    }
                    onClick={() => onPick(note)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul
              className={cn(
                "flex flex-col gap-0.5 transition-opacity duration-150 motion-reduce:transition-none",
                loading && "opacity-60"
              )}
            >
              {files.map((file) => (
                <li key={file.id}>
                  <PickerRow
                    icon={
                      <Paperclip
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
                      />
                    }
                    title={file.filename}
                    // O título da nota como legenda do arquivo: é assim que a
                    // pessoa reconhece o documento, já que ela leu o resumo e
                    // não o nome que o navegador deu ao arquivo.
                    excerpt={file.noteTitle}
                    meta={`${TYPE_LABEL[file.type] ?? "Arquivo"} · ${formatSize(file.sizeBytes)}`}
                    badge={null}
                    onClick={() => onPickAttachment(file)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

/* ---------------------------------------------------------------------- */

const TYPE_LABEL: Record<string, string> = {
  pdf: "PDF",
  audio: "Áudio",
  document: "Documento",
  image: "Imagem",
  video: "Vídeo",
  other: "Arquivo",
};

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors duration-150 pointer-coarse:py-2.5",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function PickerRow({
  icon,
  title,
  excerpt,
  meta,
  tags = [],
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  excerpt: string | null;
  meta: string;
  /** As tags da nota — só na aba Notas; os arquivos não têm. */
  tags?: BoardNoteTag[];
  badge: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2.5 text-left transition-colors duration-150 hover:bg-tertiary"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {badge}
        </span>
        {excerpt && (
          <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
            {excerpt}
          </span>
        )}
        {tags.length > 0 && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag.id}
                className={cn(
                  "max-w-[10rem] truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  storedChipClass(tag)
                )}
              >
                #{tag.name}
              </span>
            ))}
            {tags.length > 4 && (
              <span className="text-[10px] font-medium text-subtle-foreground">
                +{tags.length - 4}
              </span>
            )}
          </span>
        )}
        <span className="mt-1 block text-[11px] text-subtle-foreground">
          {meta}
        </span>
      </span>
    </button>
  );
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "tamanho desconhecido";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
