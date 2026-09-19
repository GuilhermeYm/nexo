"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import {
  ArrowLeft,
  Download,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  NOTE_TYPE_LABEL,
  NoteTypeIcon,
} from "@/components/dashboard/note-type-icon";
import { NoteAiSummary } from "@/components/editor/note-ai-summary";
import {
  NoteReferences,
  type NoteReference,
} from "@/components/editor/note-references";
import {
  NoteDetails,
  type FolderChoice,
} from "@/components/editor/note-details";
import {
  NOTE_FONT_VARIABLES,
  noteFontStyle,
} from "@/components/editor/note-font-faces";
import {
  NoteSourcePanel,
  useSourcePanel,
} from "@/components/editor/note-source-panel";
import type { EditableTag } from "@/components/editor/note-tags";
import { EditorZoomControls } from "@/components/editor/editor-zoom-controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EditorBubbleMenu } from "@/components/editor/editor-bubble-menu";
import { EditorToolbar } from "@/components/editor/editor-toolbar";
import type { WorkspaceSummary } from "@/lib/dashboard/queries";
import { buildEditorExtensions } from "@/lib/editor/extensions";
import { plainToRichDocument } from "@/lib/editor/document";
import { resolveNoteFont, type NoteFontId } from "@/lib/editor/note-fonts";
import { PROSE_EDITOR_CLASS } from "@/lib/editor/prose-classes";
import { useEditorZoom, useEditorZoomShortcuts } from "@/hooks/use-editor-zoom";
import type { NoteAiView } from "@/lib/notes/ai-view";
import type { EditableNote } from "@/lib/notes/queries";
import { cn } from "@/lib/utils";

/**
 * O editor de uma nota.
 *
 * TipTap sobre ProseMirror, sem tema importado: o pacote é headless e toda a
 * aparência sai dos tokens do projeto, então o editor pertence à "Papel
 * Amarelado" em vez de trazer a própria.
 *
 * **O que é salvo.** O que sai daqui é o documento (`contentRich`). O texto
 * puro que alimenta a busca e os resumos é derivado dele **no servidor** —
 * mandar os dois do cliente permitiria que a busca indexasse uma coisa e o
 * editor mostrasse outra.
 *
 * **Notas sem documento.** As criadas antes do editor e as escritas pela IA
 * têm `contentRich` nulo. Elas abrem a partir do texto puro, e ganham o
 * documento no primeiro salvamento — nenhuma migração de dados foi
 * necessária para isso.
 */

const SAVE_DELAY = 900;

/**
 * Quanto tempo parado até a IA ler a nota. Curto demais relê quem só foi
 * buscar café; longo demais e a aba fecha antes — o que não perde nada (sair
 * também avisa), só adia. Ver docs/IA.md.
 */
const READ_AFTER_QUIET_MS = 90_000;

type SaveState = "idle" | "saving" | "saved" | "error";

interface NoteEditorProps {
  note: EditableNote;
  workspaces: WorkspaceSummary[];
  /** A leitura da IA pintada no servidor; o componente a mantém viva. */
  ai: NoteAiView | null;
  /** As tags da conta, para as sugestões do campo de tags. */
  tagVocabulary: EditableTag[];
  /** As pastas da conta, para trocar a da nota na ficha. */
  folders: FolderChoice[];
}

type NotePatch = {
  title?: string;
  contentRich?: unknown;
  references?: NoteReference[];
  font?: NoteFontId;
};

export function NoteEditor({
  note,
  workspaces,
  ai,
  tagVocabulary,
  folders,
}: NoteEditorProps) {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteAttachments, setDeleteAttachments] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [title, setTitle] = useState(note.title);
  const [font, setFont] = useState(() => resolveNoteFont(note.font));
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<NotePatch>({});
  // Salvou algo que a IA ainda não foi chamada a ler.
  const unread = useRef(false);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(0);

  /**
   * Pede a leitura por IA. Só avisa o servidor: **se** a nota merece
   * leitura já foi decidido quando ela foi salva, e o pedido sem nada
   * pendente não custa chamada de modelo nenhuma.
   */
  const requestRead = useCallback(
    (keepalive = false) => {
      if (readTimer.current) clearTimeout(readTimer.current);
      readTimer.current = null;
      if (!unread.current) return;
      unread.current = false;
      void fetch(`/api/notes/${note.id}/analyze`, {
        method: "POST",
        keepalive,
      }).catch(() => {
        // Sem problema: a varredura do dashboard apanha a nota depois.
      });
    },
    [note.id]
  );

  const flush = useCallback(
    async (keepalive = false, read = false) => {
      const patch = queued.current;
      queued.current = {};
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (Object.keys(patch).length === 0) {
        if (read) requestRead(keepalive);
        return;
      }

      // Saindo: o pedido de leitura vai no próprio salvamento. Dois fetches
      // com `keepalive` não têm ordem garantida, e a leitura chegando antes
      // do texto leria a versão anterior.
      if (read) {
        if (readTimer.current) clearTimeout(readTimer.current);
        readTimer.current = null;
        unread.current = false;
      }

      setSaveState("saving");
      inFlight.current += 1;
      try {
        const response = await fetch(
          `/api/notes/${note.id}${read ? "?analyze=1" : ""}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
            keepalive,
          }
        );
        setSaveState(response.ok ? "saved" : "error");
        if (response.ok && !read) {
          unread.current = true;
          if (readTimer.current) clearTimeout(readTimer.current);
          readTimer.current = setTimeout(
            () => requestRead(),
            READ_AFTER_QUIET_MS
          );
        }
      } catch {
        setSaveState("error");
      } finally {
        inFlight.current -= 1;
      }
    },
    [note.id, requestRead]
  );

  const queue = useCallback(
    (patch: NotePatch) => {
      queued.current = { ...queued.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    },
    [flush]
  );

  // Sair da página com texto na fila é o momento em que ele mais se perde.
  // É também quando a IA é avisada: o servidor lê a nota mesmo com a aba já
  // fechada, porque a leitura roda lá, em `after()`.
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden") void flush(true, true);
    }
    function onPageHide() {
      void flush(true, true);
    }

    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onHide);
      void flush(true, true);
    };
  }, [flush]);

  // O aviso do navegador ao fechar, **só** com texto que ainda não chegou ao
  // servidor. O navegador não deixa escrever mensagem própria — mostra a
  // dele, genérica. Com tudo salvo não há aviso: a leitura por IA não precisa
  // da aba aberta, e interromper a pessoa por ela seria incomodar à toa.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      const pending =
        Object.keys(queued.current).length > 0 || inFlight.current > 0;
      if (!pending) return;
      event.preventDefault();
      // Navegadores antigos só mostram o aviso com `returnValue` preenchido.
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const editor = useEditor({
    // Obrigatório no App Router: renderizar o editor já no servidor produz
    // HTML que não bate com o do cliente, e a hidratação quebra.
    immediatelyRender: false,
    extensions: buildEditorExtensions({
      placeholder: "Escreva. A Nexo guarda sozinha.",
      slash: true,
    }),
    content: note.contentRich ?? plainToRichDocument(note.content),
    editorProps: {
      attributes: {
        class: "outline-none",
        // O foco é desenhado pela moldura da página, não pelo anel padrão:
        // um contorno em volta de um documento inteiro não ajuda ninguém.
        "data-focus-ring": "container",
      },
    },
    onUpdate: ({ editor: current }) =>
      queue({ contentRich: current.getJSON() }),
  });
  const textZoom = useEditorZoom("nexo-note-editor-zoom");
  useEditorZoomShortcuts(editor, textZoom);

  const handleTitle = useCallback(
    (value: string) => {
      setTitle(value);
      const trimmed = value.trim();
      // O schema recusa título vazio; guardar só quando houver algo evita um
      // 400 a cada tecla enquanto a pessoa apaga para reescrever.
      if (trimmed) queue({ title: trimmed });
    },
    [queue]
  );

  const handleFont = useCallback(
    (next: NoteFontId) => {
      setFont(next);
      queue({ font: next });
    },
    [queue]
  );

  const openInWorkspace = useCallback(
    async (workspaceId: string) => {
      await flush();
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/windows`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "note", noteId: note.id }),
        });
        const body = await response.json().catch(() => null);
        router.push(
          body?.windowId
            ? `/workspace/${workspaceId}?focus=${body.windowId}`
            : `/workspace/${workspaceId}`
        );
      } catch {
        setSaveState("error");
      }
    },
    [flush, note.id, router]
  );

  const deleteNote = useCallback(async () => {
    queued.current = {};
    if (timer.current) clearTimeout(timer.current);
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteAttachments }),
      });
      if (!response.ok) throw new Error("delete request failed");
      router.push("/dashboard");
    } catch {
      setDeleteError("Não foi possível excluir a nota. Tente novamente.");
    } finally {
      setDeleting(false);
    }
  }, [deleteAttachments, note.id, router]);

  // O arquivo de onde a nota nasceu abre ao lado, não em outra aba: a pessoa
  // lê o PDF e escreve a nota na mesma tela, como na lousa.
  const sourcePanel = useSourcePanel(note.attachment !== null);
  const setSourceOpen = sourcePanel.setOpen;
  const closeSourcePanel = useCallback(
    () => setSourceOpen(false),
    [setSourceOpen]
  );

  return (
    // As variantes `print:` desmontam o chrome da tela na impressão: a página
    // é 100dvh com rolagem interna, e sem elas o PDF sairia com uma página só
    // — o recorte do que está visível no viewport.
    // `NOTE_FONT_VARIABLES` publica as `--font-note-*` para a página inteira:
    // o documento as usa, e a barra desenha o nome de cada fonte nela mesma.
    <div
      className={cn(
        "flex h-[100dvh] flex-col overflow-hidden bg-background print:h-auto print:overflow-visible",
        NOTE_FONT_VARIABLES
      )}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2.5 sm:px-4 print:hidden">
        <Link
          href="/dashboard"
          className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:h-11"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>

        <div className="flex min-w-0 items-center gap-2">
          <NoteTypeIcon
            type={note.type}
            className="size-4 shrink-0 text-subtle-foreground"
          />
          <span className="shrink-0 text-xs text-subtle-foreground">
            {NOTE_TYPE_LABEL[note.type] ?? "Nota"}
          </span>
          {note.source === "ai" && (
            // Autoria da IA é sempre visível — princípio nº 4 do produto.
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tertiary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              <Sparkles className="size-2.5" aria-hidden="true" />
              pela Nexo
            </span>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <SaveIndicator state={saveState} />

          {note.attachment && (
            <button
              type="button"
              onClick={() => sourcePanel.setOpen(!sourcePanel.open)}
              aria-pressed={sourcePanel.open}
              title={
                sourcePanel.open
                  ? "Fechar o arquivo de origem"
                  : "Ver o arquivo de origem ao lado da nota"
              }
              className={cn(
                "flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm transition-colors duration-150 pointer-coarse:h-11",
                sourcePanel.open
                  ? "bg-tertiary text-foreground"
                  : "text-muted-foreground hover:bg-tertiary hover:text-foreground"
              )}
            >
              {sourcePanel.open ? (
                <PanelRightClose className="size-4" aria-hidden="true" />
              ) : (
                <PanelRightOpen className="size-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">Arquivo</span>
            </button>
          )}

          <ContextMenu>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  event.currentTarget.dispatchEvent(
                    new MouseEvent("contextmenu", {
                      bubbles: true,
                      clientX: box.right,
                      clientY: box.bottom,
                    })
                  );
                }}
                className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:h-11"
              >
                <LayoutGrid className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Ações</span>
              </button>
            </ContextMenuTrigger>

            <ContextMenuContent>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <LayoutGrid className="size-4 shrink-0 text-subtle-foreground" />
                  <span className="min-w-0 flex-1 font-medium">
                    Abrir no workspace
                  </span>
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {workspaces.map((workspace) => (
                    <ContextMenuItem
                      key={workspace.id}
                      onSelect={() => openInWorkspace(workspace.id)}
                    >
                      <ContextMenuItemLabel label={workspace.name} />
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>

              <ContextMenuItem onSelect={() => window.print()}>
                <Download className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
                <ContextMenuItemLabel
                  label="Exportar PDF"
                  hint="Abre a impressão do navegador — escolha “Salvar como PDF”."
                />
              </ContextMenuItem>

              <ContextMenuSeparator />

              <ContextMenuItem
                destructive
                confirmLabel="Excluir para valer"
                onSelect={() => {
                  setDeleteAttachments(false);
                  setDeleteError(null);
                  setDeleteDialogOpen(true);
                }}
              >
                <Trash2 className="mt-0.5 size-4 shrink-0" />
                <ContextMenuItemLabel
                  label="Excluir nota"
                  hint="Sai da conta, da busca e de todas as lousas."
                />
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      </header>

      <EditorBubbleMenu editor={editor} />

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Excluir esta nota?"
        description="Ela sairá da sua conta, da busca e de todas as lousas em que estiver aberta."
        subject={note.title || "Sem título"}
        confirmLabel="Excluir nota"
        busyLabel="Excluindo nota…"
        busy={deleting}
        error={deleteError ?? undefined}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={() => void deleteNote()}
      >
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-secondary px-3.5 py-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={deleteAttachments}
            onChange={(event) => setDeleteAttachments(event.target.checked)}
            disabled={deleting}
            className="mt-0.5 size-4 accent-error"
          />
          <span>
            <span className="block font-medium">
              Apagar também os arquivos associados
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              Essa escolha remove permanentemente os arquivos enviados junto com
              a nota.
            </span>
          </span>
        </label>
      </ConfirmDialog>

      {/* A nota à esquerda, o arquivo à direita. A barra de formatação fica
          na coluna da nota: ela formata o texto, não o arquivo. */}
      <div className="flex min-h-0 flex-1 print:block">
        <div className="flex min-w-0 flex-1 flex-col print:block">
          <EditorToolbar
            editor={editor}
            font={font}
            onFontChange={handleFont}
            className="print:hidden"
          />
          <div className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
            {/* A fonte escolhida vale daqui para dentro: título, corpo e
                referências. A ficha e o rodapé voltam à fonte da interface
                (`font-sans`) — são controles, não texto da nota. */}
            <div
              style={noteFontStyle(font)}
              className="mx-auto w-full max-w-2xl px-6 pt-10 pb-12 print:max-w-none print:px-0 print:pt-0"
            >
              <label className="sr-only" htmlFor="note-title">
                Título da nota
              </label>
              {/* Textarea e não input: um título longo quebra linha em vez
                  de sumir pela direita — com o arquivo aberto ao lado, a
                  coluna da nota fica estreita. `field-sizing` faz a altura
                  seguir o texto; Enter não quebra linha, porque título é uma
                  linha só, e desce para o corpo. */}
              <textarea
                id="note-title"
                rows={1}
                value={title}
                onChange={(event) =>
                  handleTitle(event.target.value.replace(/\s*\n\s*/g, " "))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    editor?.commands.focus("start");
                  }
                }}
                placeholder="Sem título"
                maxLength={200}
                data-focus-ring="container"
                // Sem borda, contorno nem anel: o título é texto da página, e o
                // cursor piscando já diz onde está o foco.
                className="w-full resize-none border-0 bg-transparent p-0 text-3xl leading-[1.15] font-bold tracking-[-0.02em] text-balance text-foreground shadow-none outline-none [field-sizing:content] placeholder:text-subtle-foreground font-[family-name:var(--font-display)] focus:outline-none focus-visible:outline-none sm:text-4xl"
              />

              {/* As propriedades da nota — de onde veio, como está
                  marcada, onde mora. Recolhível; ver o componente. */}
              <NoteDetails
                note={note}
                tagVocabulary={tagVocabulary}
                folders={folders}
                sourceOpen={sourcePanel.open}
                onToggleSource={() => sourcePanel.setOpen(!sourcePanel.open)}
              />

              {/* O fim do cabeçalho da página — título, origem e tags — e o
                  começo do corpo. Vai para o PDF também: separa a ficha do
                  texto no papel do mesmo jeito. */}
              <hr className="mt-6 border-0 border-t border-border print:border-neutral-300" />

              {/* A tipografia do documento vive em `PROSE_EDITOR_CLASS`, por
              descendência: o conteúdo é gerado pelo ProseMirror e não passa
              pelas nossas classes um a um. Aqui só a altura e a margem, que
              são desta tela. */}
              <EditorContent
                editor={editor}
                style={{ zoom: textZoom.zoom / 100 }}
                className={cn(
                  "mt-6 [&_.tiptap]:min-h-[50vh] print:[&_.tiptap]:min-h-0",
                  PROSE_EDITOR_CLASS
                )}
              />

              <NoteReferences
                initial={note.references}
                onChange={(references) => queue({ references })}
              />
              {/* O rodapé da nota: o resumo da Nexo no canto, o zoom do outro
              lado. No celular o zoom sobe e o resumo fica embaixo, com a
              largura inteira para ser lido. */}
              <div className="mt-10 flex flex-col-reverse gap-4 border-t border-border pt-3 font-sans sm:flex-row sm:items-start sm:justify-between print:hidden">
                <NoteAiSummary noteId={note.id} initial={ai} />
                <EditorZoomControls
                  className="shrink-0 self-end sm:self-auto"
                  zoom={textZoom.zoom}
                  onDecrease={() => {
                    textZoom.decrease();
                    editor?.commands.focus();
                  }}
                  onIncrease={() => {
                    textZoom.increase();
                    editor?.commands.focus();
                  }}
                  onReset={() => {
                    textZoom.reset();
                    editor?.commands.focus();
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {note.attachment && sourcePanel.open && (
          <NoteSourcePanel
            source={note.attachment}
            wide={sourcePanel.wide}
            onClose={closeSourcePanel}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

/**
 * Estado do salvamento.
 *
 * `polite` porque interromper a leitura de tela a cada autosave seria pior
 * que não anunciar nada.
 */
function SaveIndicator({ state }: { state: SaveState }) {
  const text = {
    idle: "",
    saving: "Salvando…",
    saved: "Salvo",
    error: "Não salvou",
  }[state];

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "text-xs tabular-nums",
        state === "error" ? "text-error" : "text-subtle-foreground"
      )}
    >
      {text}
    </span>
  );
}
