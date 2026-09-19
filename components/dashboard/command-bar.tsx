"use client";

import {
  CircleAlert,
  FileText,
  LoaderCircle,
  Maximize2,
  Paperclip,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { NoteTypeIcon } from "@/components/dashboard/note-type-icon";
import { ErrorReport } from "@/components/errors/error-report";
import { NotePreviewPanel } from "@/components/notes/notes-view";
import {
  ATTACHMENT_TYPE_NAME,
  AttachmentIcon,
} from "@/components/files/attachment-icon";
import { FileViewerDialog } from "@/components/files/file-viewer-dialog";
import type { AttachmentListItem } from "@/lib/attachments/list";
import type { RecentNote } from "@/lib/dashboard/queries";
import { readApiFailure } from "@/lib/api-failure";
import type { NotePreview } from "@/lib/notes/list";
import { TAG_DOT_CLASS, tagTone } from "@/lib/tags/palette";
import { cn, formatBytes } from "@/lib/utils";

/**
 * As perguntas que rodam no placeholder.
 *
 * São exemplos do que o usuário realmente guardou — captura de reunião, PDF,
 * ideia solta —, não slogans. O placeholder é a única documentação que essa
 * barra tem, então ele ensina o escopo em vez de enfeitar.
 */
const PLACEHOLDERS = [
  "Busque uma nota, um áudio, um PDF…",
  "o que ficou decidido na reunião de terça?",
  "aquele contrato que chegou semana passada",
  "a ideia que anotei de madrugada",
  "notas marcadas com #pesquisa",
];

const ROTATION_MS = 4200;
const SEARCH_DEBOUNCE_MS = 220;

/** O que a busca achou: notas primeiro, arquivos depois (`GET /api/search`). */
interface SearchHits {
  notes: RecentNote[];
  files: AttachmentListItem[];
  tags: SearchTag[];
}

interface SearchTag {
  id: string;
  name: string;
  color: string | null;
  noteCount: number;
}

/** Uma linha da lista, na ordem em que as setas percorrem: notas, arquivos. */
type SearchEntry =
  | { kind: "note"; note: RecentNote }
  | { kind: "file"; file: AttachmentListItem }
  | { kind: "tag"; tag: SearchTag };

function toEntries(hits: SearchHits): SearchEntry[] {
  return [
    ...hits.tags.map((tag) => ({ kind: "tag" as const, tag })),
    ...hits.notes.map((note) => ({ kind: "note" as const, note })),
    ...hits.files.map((file) => ({ kind: "file" as const, file })),
  ];
}

const NO_HITS: SearchHits = { notes: [], files: [], tags: [] };

type UploadState =
  | { phase: "idle" }
  | { phase: "sending"; filename: string }
  | { phase: "done"; filename: string }
  | {
      phase: "error";
      message: string;
      /** Código do relatório, quando o servidor registrou um defeito. */
      code?: string | null;
    };

interface CommandBarProps {
  onOpenNote: (noteId: string) => void;
  /** Chamado quando um upload conclui, para o painel de Tarefas revalidar
   *  sem esperar o evento do Realtime dar a volta. */
  onUploaded: () => void;
  /** Entrega ao shell uma função que abre o seletor de arquivo — o estado
   *  vazio de Tarefas a chama para o "Enviar um arquivo" funcionar de lá. */
  registerPickFile?: (pick: () => void) => void;
}

export function CommandBar({
  onOpenNote,
  onUploaded,
  registerPickFile,
}: CommandBarProps) {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const expandedInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previewDialogRef = useRef<HTMLDialogElement>(null);

  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // O resultado carrega a busca que o originou. Guardar as duas coisas
  // juntas é o que permite derivar “está buscando” sem um segundo estado —
  // e sem precisar zerar nada dentro do efeito, o que dispara render em
  // cascata no React 19.
  const [results, setResults] = useState<{
    query: string;
    hits: SearchHits;
  } | null>(null);
  /** O arquivo aberto no visualizador, por cima do painel. */
  const [viewing, setViewing] = useState<AttachmentListItem | null>(null);
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);
  const [preview, setPreview] = useState<NotePreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "error">("idle");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [highlight, setHighlight] = useState(-1);
  const [upload, setUpload] = useState<UploadState>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);

  // Índice do placeholder: começa em 0 nos dois lados (servidor e cliente) e
  // só passa a girar depois de montado — senão o HTML não bateria.
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = setInterval(() => {
      setPlaceholderIndex((current) => (current + 1) % PLACEHOLDERS.length);
    }, ROTATION_MS);

    return () => clearInterval(timer);
  }, []);

  /* --- Busca ---------------------------------------------------------- */

  const searchAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      searchAbort.current?.abort();
      return;
    }

    const timer = setTimeout(async () => {
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;

      try {
        const isTagSearch = trimmed.startsWith("#");
        const tagQuery = isTagSearch ? trimmed.slice(1).trim() : trimmed;
        const params = new URLSearchParams({
          q: tagQuery,
          ...(isTagSearch ? { scope: "tags" } : {}),
        });
        const response = await fetch(
          `/api/search?${params}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          setResults({ query: trimmed, hits: NO_HITS });
          return;
        }
        const payload = await response.json();
        setResults({
          query: trimmed,
          hits: {
            notes: payload.notes ?? [],
            files: payload.files ?? [],
            tags: payload.tags ?? [],
          },
        });
        setHighlight(-1);
      } catch (error) {
        // Abort é o caso normal — uma busca mais nova cancelou esta, e a
        // resposta dela é que manda. Qualquer outra falha precisa tirar a
        // lista do esqueleto: senão ela fica carregando para sempre.
        if ((error as Error)?.name !== "AbortError") {
          setResults({ query: trimmed, hits: NO_HITS });
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!previewNoteId) return;

    const controller = new AbortController();
    setPreview(null);
    setPreviewStatus("loading");

    async function loadPreview() {
      try {
        const response = await fetch(`/api/notes/${previewNoteId}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("preview request failed");
        const payload = (await response.json()) as { note: NotePreview };
        if (!controller.signal.aborted) {
          setPreview(payload.note);
          setPreviewStatus("idle");
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") setPreviewStatus("error");
      }
    }

    void loadPreview();
    return () => controller.abort();
  }, [previewNoteId, previewAttempt]);

  /* --- Upload --------------------------------------------------------- */

  const sendFile = useCallback(
    async (file: File) => {
      setUpload({ phase: "sending", filename: file.name });

      try {
        const body = new FormData();
        body.append("file", file);

        const response = await fetch("/api/attachments", {
          method: "POST",
          body,
        });

        if (!response.ok) {
          const failure = await readApiFailure(
            response,
            response.status === 429
              ? "Limite de envios por hora atingido."
              : response.status === 413 || response.status === 400
                ? "Arquivo não aceito. Confira o tipo e o tamanho (até 25 MB)."
                : "Não foi possível enviar. Tente novamente."
          );

          setUpload({
            phase: "error",
            // O 429 é da proteção contra abuso: a mensagem do servidor ali
            // não ajuda mais que a nossa.
            message:
              response.status === 429
                ? "Limite de envios por hora atingido."
                : failure.message,
            code: failure.code,
          });
          return;
        }

        setUpload({ phase: "done", filename: file.name });
        onUploaded();
      } catch {
        setUpload({ phase: "error", message: "Erro de conexão ao enviar." });
      }
    },
    [onUploaded]
  );

  // A confirmação de envio não fica na tela para sempre: some sozinha e
  // devolve a barra ao repouso. Erro fica — ele precisa ser lido.
  useEffect(() => {
    if (upload.phase !== "done") return;
    const timer = setTimeout(() => setUpload({ phase: "idle" }), 4000);
    return () => clearTimeout(timer);
  }, [upload]);

  useEffect(() => {
    registerPickFile?.(() => fileRef.current?.click());
  }, [registerPickFile]);

  /* --- Teclado -------------------------------------------------------- */

  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    fromExpandedSearch = false
  ) {
    if (event.key === "Escape") {
      if (fromExpandedSearch) {
        event.preventDefault();
        setExpanded(false);
        return;
      }
      if (query) {
        setQuery("");
      } else {
        inputRef.current?.blur();
      }
      return;
    }

    const items =
      results?.query === query.trim() ? toEntries(results.hits) : null;
    if (!items || items.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => (index + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => (index <= 0 ? items.length - 1 : index - 1));
    } else if (event.key === "Enter" && highlight >= 0) {
      event.preventDefault();
      openEntry(items[highlight]);
    }
  }

  function openEntry(entry: SearchEntry) {
    if (entry.kind === "note") openNotePreview(entry.note.id);
    else if (entry.kind === "file") openFile(entry.file);
    else openTag(entry.tag.id);
  }

  function openTag(tagId: string) {
    setExpanded(false);
    setFocused(false);
    router.push(`/dashboard/tags?tag=${encodeURIComponent(tagId)}`);
  }

  function openNotePreview(noteId: string) {
    setExpanded(false);
    setFocused(false);
    setPreviewNoteId(noteId);
  }

  function closeNotePreview() {
    setPreviewNoteId(null);
    setPreview(null);
    setPreviewStatus("idle");
  }

  /** O arquivo abre por cima da busca ampliada, sem encerrar a consulta. */
  function openFile(file: AttachmentListItem) {
    if (!expanded) setFocused(false);
    setViewing(file);
  }

  function closeFileViewer() {
    setViewing(null);

    // Esc fecha primeiro o arquivo e devolve o foco à busca. Só o próximo Esc
    // encerra a superfície ampliada, preservando a consulta entre os dois.
    if (expanded) {
      window.requestAnimationFrame(() => expandedInputRef.current?.focus());
    }
  }

  /** Abertura de uma nota também encerra a superfície temporária da busca. */
  function openNote(noteId: string) {
    setExpanded(false);
    setFocused(false);
    onOpenNote(noteId);
  }

  // Ctrl+K (Windows/Linux) e ⌘K (macOS) são a porta rápida para reencontrar.
  // O atalho vale mesmo quando há um rascunho aberto, mas não atravessa outro
  // diálogo modal que já esteja cuidando do próprio foco.
  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      const openDialog = document.querySelector("dialog[open]");
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        (openDialog !== null && openDialog !== dialogRef.current)
      ) {
        return;
      }

      event.preventDefault();
      setFocused(true);
      window.requestAnimationFrame(() => {
        (expanded ? expandedInputRef : inputRef).current?.focus();
      });
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [expanded]);

  useEffect(() => {
    const dialog = previewDialogRef.current;
    if (!dialog) return;

    if (previewNoteId && !dialog.open) dialog.showModal();
    if (!previewNoteId && dialog.open) dialog.close();
  }, [previewNoteId]);

  // O diálogo nativo sobe para a top layer, aplica o backdrop e mantém o foco
  // dentro da busca ampliada. Não é uma cópia da busca: compartilha a mesma
  // consulta, resultados e seleção por teclado da barra compacta.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (expanded && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => expandedInputRef.current?.focus());
    }
    if (!expanded && dialog.open) dialog.close();
  }, [expanded]);

  // Fechar ao clicar fora — a lista é um overlay e não pode ficar presa
  // aberta quando o usuário já foi cuidar de outra coisa.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setFocused(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const trimmedQuery = query.trim();
  // Só vale o resultado da busca que está no campo agora. Enquanto a
  // resposta da busca atual não chega, `current` é null e a lista mostra o
  // esqueleto — sem precisar de um estado “carregando” separado.
  const current = results?.query === trimmedQuery ? results.hits : null;
  const searching = trimmedQuery.length > 0 && current === null;
  const showResults = focused && trimmedQuery.length > 0;

  return (
    <div ref={rootRef} className="relative w-full">
      {/* O campo e a lista dividem um contexto de posicionamento próprio, para
          a lista pendurar na borda do campo — e não abaixo do texto de ajuda,
          que fica fora deste bloco. */}
      <div className="relative">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void sendFile(file);
          }}
          className={cn(
            "flex items-center gap-3 rounded-2xl border bg-background px-4",
            "transition-[border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none",
            dragging
              ? "border-accent shadow-[0_2px_24px_-8px] shadow-accent/30"
              : focused && inputFocused
                ? "border-subtle-foreground shadow-[0_2px_20px_-10px] shadow-black/25"
                : "border-border hover:border-subtle-foreground/60"
          )}
        >
          <span className="shrink-0 text-subtle-foreground">
            {searching ? (
              <LoaderCircle
                className="size-[18px] animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Search className="size-[18px]" aria-hidden="true" />
            )}
          </span>

          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => {
                setFocused(true);
                setInputFocused(true);
              }}
              onBlur={() => setInputFocused(false)}
              onDoubleClick={() => setExpanded(true)}
              onKeyDown={(event) => handleKeyDown(event)}
              role="combobox"
              aria-expanded={showResults}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-label="Buscar nas suas notas e arquivos"
              data-focus-ring="container"
              // O placeholder de verdade fica vazio: quem desenha o texto é a
              // camada abaixo, que precisa de transição entre as frases. O
              // anel de foco também é do contêiner, não do campo.
              placeholder=""
              className="h-14 w-full bg-transparent text-[15px] text-foreground outline-none [&::-webkit-search-cancel-button]:hidden"
            />

            {query.length === 0 && (
              // `inset-0`, não `inset-y-0 left-0`: sem largura própria a faixa
              // colapsa em zero e o `overflow-hidden` recorta o texto inteiro —
              // o placeholder existia, só nunca aparecia.
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center overflow-hidden"
              >
                {PLACEHOLDERS.map((text, index) => (
                  <span
                    key={text}
                    className={cn(
                      "absolute whitespace-nowrap text-[15px] text-subtle-foreground",
                      "transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
                      index === placeholderIndex
                        ? "translate-y-0 opacity-100"
                        : "pointer-events-none translate-y-2 opacity-0"
                    )}
                  >
                    {text}
                  </span>
                ))}
              </span>
            )}
          </div>

          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Limpar busca</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setExpanded(true)}
            title="Abrir a busca ampliada"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
          >
            <Maximize2 className="size-[18px]" aria-hidden="true" />
            <span className="sr-only">Abrir a busca ampliada</span>
          </button>

          <kbd className="hidden shrink-0 rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-subtle-foreground sm:inline">
            Ctrl K
          </kbd>

          <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.md,.docx,.mp3,.wav,.m4a"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void sendFile(file);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={upload.phase === "sending"}
              title="Enviar arquivo (imagem, PDF, texto, áudio)"
              className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {upload.phase === "sending" ? (
                <LoaderCircle
                  className="size-[18px] animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Paperclip className="size-[18px]" aria-hidden="true" />
              )}
              <span className="sr-only">Enviar arquivo</span>
            </button>

            {/* Pedir para a IA ainda não tem controle de crédito, então o botão
                existe desabilitado em vez de sumir: o usuário fica sabendo que
                o caminho existe, e por que ainda não dá. */}
            <button
              type="button"
              disabled
              aria-describedby={`${listboxId}-ai`}
              className="flex h-9 cursor-not-allowed items-center gap-1.5 rounded-xl px-2.5 text-muted-foreground opacity-55"
            >
              <Sparkles className="size-[18px]" aria-hidden="true" />
              <span className="hidden text-sm font-medium sm:inline">
                Pedir à IA
              </span>
            </button>
          </div>
        </div>

        {showResults && (
          <div
            id={listboxId}
            role="listbox"
            aria-label="Resultados da busca"
            className="absolute inset-x-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-2xl border border-border bg-background shadow-[0_16px_48px_-16px] shadow-black/30"
          >
            <SearchResults
              current={current}
              query={query}
              highlight={highlight}
              onHighlight={setHighlight}
              onOpen={openEntry}
            />
          </div>
        )}
      </div>

      {/* A linha de rodapé da barra: o que está acontecendo à esquerda, a
          atribuição do modelo à direita.

          O crédito fica aqui, e não colado no botão "Pedir à IA": a Groq já
          classifica cada arquivo enviado hoje, enquanto o botão continua
          esperando os créditos. Preso ao botão, o crédito diria a coisa errada
          — que a IA ainda não está em uso. */}
      <div className="mt-2.5 flex items-baseline justify-between gap-3 px-1">
        <p
          id={`${listboxId}-ai`}
          className="min-w-0 text-xs text-subtle-foreground"
        >
          {upload.phase === "sending" ? (
            <span className="text-muted-foreground">
              Enviando {upload.filename}… a Nexo classifica assim que chegar.
            </span>
          ) : upload.phase === "done" ? (
            <span className="text-muted-foreground">
              {upload.filename} chegou. A classificação aparece em Tarefas.
            </span>
          ) : upload.phase === "error" ? (
            <span className="flex items-center gap-1.5 text-error">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              {upload.message}
            </span>
          ) : (
            <>
              Busca e envio estão no ar. Pedir à IA em linguagem natural vem
              depois — e vai responder sobre workspaces, pastas e tags.
            </>
          )}
        </p>

        <span className="shrink-0 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap text-subtle-foreground/70 uppercase">
          Powered by Groq
        </span>
      </div>

      {/* Fora do `<p>` acima, e não dentro: o relato tem um campo de texto e
          botões, e `<div>` dentro de `<p>` é HTML inválido — o navegador
          fecharia o parágrafo sozinho e o layout iria junto.

          Só aparece quando o servidor devolveu código, ou seja, quando houve
          defeito de verdade. Teto de plano e arquivo recusado não têm o que
          reportar: os dois já disseram o que fazer. */}
      {upload.phase === "error" && upload.code ? (
        <ErrorReport
          className="mt-2 px-1"
          code={upload.code}
          route="/api/attachments"
          compact
        />
      ) : null}

      <dialog
        ref={dialogRef}
        aria-labelledby={`${listboxId}-expanded-title`}
        onClose={() => setExpanded(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setExpanded(false);
        }}
        className="m-auto w-[min(54rem,calc(100%-1.5rem))] border-0 bg-transparent p-0 text-foreground backdrop:bg-black/35 backdrop:backdrop-blur-[3px]"
      >
        <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-[0_24px_80px_-28px] shadow-black/50">
          <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div>
              <h2
                id={`${listboxId}-expanded-title`}
                className="text-base font-semibold text-foreground"
              >
                Buscar na Nexo
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Encontre notas e arquivos pelo nome, conteúdo ou contexto.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            >
              <X className="size-[18px]" aria-hidden="true" />
              <span className="sr-only">Fechar a busca ampliada</span>
            </button>
          </header>

          <div className="p-4 sm:p-6">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/60 px-4 shadow-[0_8px_28px_-18px] shadow-black/35 transition-[background-color,border-color,box-shadow] duration-150 focus-within:border-accent focus-within:bg-background motion-reduce:transition-none">
              <span className="shrink-0 text-subtle-foreground">
                {searching ? (
                  <LoaderCircle
                    className="size-5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <Search className="size-5" aria-hidden="true" />
                )}
              </span>
              <input
                ref={expandedInputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => handleKeyDown(event, true)}
                role="combobox"
                aria-expanded={trimmedQuery.length > 0}
                aria-controls={`${listboxId}-expanded`}
                aria-autocomplete="list"
                aria-label="Buscar nas suas notas e arquivos"
                autoComplete="off"
                data-focus-ring="container"
                placeholder="Busque uma nota, uma decisão, um arquivo…"
                className="h-15 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-subtle-foreground [&::-webkit-search-cancel-button]:hidden sm:text-lg"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    expandedInputRef.current?.focus();
                  }}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                  <span className="sr-only">Limpar busca</span>
                </button>
              )}
            </div>

            {trimmedQuery ? (
              <div
                id={`${listboxId}-expanded`}
                role="listbox"
                aria-label="Resultados da busca ampliada"
                className="mt-3 overflow-hidden rounded-xl border border-border bg-background"
              >
                <SearchResults
                  current={current}
                  query={query}
                  highlight={highlight}
                  onHighlight={setHighlight}
                  onOpen={openEntry}
                  expanded
                />
              </div>
            ) : (
              <p className="px-1 py-7 text-center text-sm leading-relaxed text-muted-foreground">
                Escreva o que você lembra. A Nexo também procura dentro das suas
                notas e no que leu dos seus arquivos, não só nos nomes.
              </p>
            )}
          </div>

          <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-5 py-3 text-xs text-subtle-foreground sm:px-6">
            <span>↑↓ para navegar</span>
            <span>Enter para abrir</span>
            <span>Esc para fechar</span>
          </footer>
        </div>
      </dialog>

      <dialog
        ref={previewDialogRef}
        aria-label="Prévia da nota"
        onClose={closeNotePreview}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeNotePreview();
        }}
        className="m-auto w-[min(42rem,calc(100%-1.5rem))] border-0 bg-transparent p-0 text-foreground backdrop:bg-black/35 backdrop:backdrop-blur-[3px]"
      >
        <NotePreviewPanel
          preview={preview}
          status={previewStatus}
          now={Date.now()}
          onClose={closeNotePreview}
          onRetry={() => setPreviewAttempt((attempt) => attempt + 1)}
        />
      </dialog>

      <FileViewerDialog attachment={viewing} onClose={closeFileViewer} />
    </div>
  );
}

function SearchResults({
  current,
  query,
  highlight,
  onHighlight,
  onOpen,
  expanded = false,
}: {
  current: SearchHits | null;
  query: string;
  highlight: number;
  onHighlight: (index: number) => void;
  onOpen: (entry: SearchEntry) => void;
  expanded?: boolean;
}) {
  if (current === null) return <ResultsSkeleton />;

  const tagSearch = query.trim().startsWith("#");
  if (current.tags.length === 0 && current.notes.length === 0 && current.files.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        Nada encontrado para <span className="text-foreground">“{query.trim()}”</span>.
        {tagSearch
          ? " Tente outro nome de tag."
          : " Tente outras palavras — a busca também lê o conteúdo, não só o nome."}
      </p>
    );
  }

  const rowClass = (index: number) =>
    cn(
      "flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors duration-150 focus-visible:bg-secondary focus-visible:outline-none",
      index === highlight ? "bg-secondary" : "bg-transparent",
      expanded && "py-3"
    );
  // Os títulos dos grupos só aparecem quando há arquivo: sem ele, a lista é a
  // mesma de antes, só de notas.
  const grouped = current.files.length > 0;
  const noteOffset = current.tags.length;
  const fileOffset = noteOffset + current.notes.length;

  return (
    <div className={cn("overflow-y-auto py-1.5", expanded ? "max-h-[50vh]" : "max-h-[340px]")}>
      {current.tags.length > 0 && (
        <ResultGroup label="Tags">
          {current.tags.map((tag, index) => (
            <li key={tag.id}>
              <button
                type="button"
                role="option"
                data-focus-ring="container"
                aria-selected={index === highlight}
                onMouseEnter={() => onHighlight(index)}
                onFocus={() => onHighlight(index)}
                onClick={() => onOpen({ kind: "tag", tag })}
                className={rowClass(index)}
              >
                <span
                  aria-hidden="true"
                  className={cn("mt-1 size-2.5 shrink-0 rounded-full", TAG_DOT_CLASS[tagTone(tag)])}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  #{tag.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                  {tag.noteCount} {tag.noteCount === 1 ? "nota" : "notas"}
                </span>
              </button>
            </li>
          ))}
        </ResultGroup>
      )}
      {current.notes.length > 0 && (
        <ResultGroup label={grouped ? "Notas" : null}>
          {current.notes.map((note, index) => (
            <li key={note.id}>
              <button
                type="button"
                role="option"
                data-focus-ring="container"
                aria-selected={noteOffset + index === highlight}
                onMouseEnter={() => onHighlight(noteOffset + index)}
                onFocus={() => onHighlight(noteOffset + index)}
                onClick={() => onOpen({ kind: "note", note })}
                className={rowClass(noteOffset + index)}
              >
                <NoteTypeIcon
                  type={note.type}
                  className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {note.title}
                  </span>
                  {note.summary ? (
                    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-subtle-foreground">
                      <Sparkles className="size-3 shrink-0" aria-hidden="true" />
                      <span className="sr-only">Resumo da Nexo: </span>
                      <span className="truncate">{note.summary}</span>
                    </span>
                  ) : note.excerpt ? (
                    <span className="mt-0.5 block truncate text-xs text-subtle-foreground">
                      {note.excerpt}
                    </span>
                  ) : null}
                </span>
                {note.workspaceName && (
                  <span className="mt-0.5 shrink-0 text-xs text-subtle-foreground">
                    {note.workspaceName}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ResultGroup>
      )}

      {grouped && (
        <ResultGroup label="Arquivos">
          {current.files.map((file, fileIndex) => {
            const index = fileOffset + fileIndex;
            return (
              <li key={file.id}>
                <button
                  type="button"
                  role="option"
                  data-focus-ring="container"
                  aria-selected={index === highlight}
                  onMouseEnter={() => onHighlight(index)}
                  onFocus={() => onHighlight(index)}
                  onClick={() => onOpen({ kind: "file", file })}
                  className={rowClass(index)}
                >
                  <AttachmentIcon
                    type={file.type}
                    className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {file.filename}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-subtle-foreground">
                      {ATTACHMENT_TYPE_NAME[file.type]}
                      {file.note ? ` · Nota: ${file.note.title}` : ""}
                    </span>
                  </span>
                  {file.sizeBytes !== null && (
                    <span className="mt-0.5 shrink-0 text-xs tabular-nums text-subtle-foreground">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ResultGroup>
      )}
    </div>
  );
}

function ResultGroup({
  label,
  children,
}: {
  label: string | null;
  children: ReactNode;
}) {
  const labelId = useId();
  if (!label) return <ul role="group">{children}</ul>;
  return (
    <ul role="group" aria-labelledby={labelId} className="[&+&]:mt-1.5 [&+&]:border-t [&+&]:border-border [&+&]:pt-1.5">
      <li
        id={labelId}
        role="presentation"
        className="px-4 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-subtle-foreground uppercase"
      >
        {label}
      </li>
      {children}
    </ul>
  );
}

function ResultsSkeleton() {
  return (
    <ul className="py-1.5" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-start gap-3 px-4 py-2.5">
          <FileText className="mt-0.5 size-4 shrink-0 text-border" />
          <span className="flex-1 space-y-1.5">
            <span
              className="block h-3 animate-pulse rounded bg-secondary motion-reduce:animate-none"
              style={{ width: `${68 - row * 12}%` }}
            />
            <span
              className="block h-2.5 animate-pulse rounded bg-secondary motion-reduce:animate-none"
              style={{ width: `${44 - row * 8}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
