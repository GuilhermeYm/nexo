"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { ArrowLeft, Download, LayoutGrid, Paperclip, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  NOTE_TYPE_LABEL,
  NoteTypeIcon,
} from "@/components/dashboard/note-type-icon";
import { NoteTags } from "@/components/editor/note-tags";
import { EditorZoomControls } from "@/components/editor/editor-zoom-controls";
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
import { PROSE_EDITOR_CLASS } from "@/lib/editor/prose-classes";
import { useEditorZoom, useEditorZoomShortcuts } from "@/hooks/use-editor-zoom";
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

type SaveState = "idle" | "saving" | "saved" | "error";

interface NoteEditorProps {
  note: EditableNote;
  workspaces: WorkspaceSummary[];
}

export function NoteEditor({ note, workspaces }: NoteEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<{ title?: string; contentRich?: unknown }>({});

  const flush = useCallback(
    async (keepalive = false) => {
      const patch = queued.current;
      queued.current = {};
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (Object.keys(patch).length === 0) return;

      setSaveState("saving");
      try {
        const response = await fetch(`/api/notes/${note.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
          keepalive,
        });
        setSaveState(response.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
    },
    [note.id]
  );

  const queue = useCallback(
    (patch: { title?: string; contentRich?: unknown }) => {
      queued.current = { ...queued.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    },
    [flush]
  );

  // Sair da página com texto na fila é o momento em que ele mais se perde.
  useEffect(() => {
    function onHide() {
      void flush(true);
    }

    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      void flush(true);
    };
  }, [flush]);

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
    try {
      await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    } finally {
      router.push("/dashboard");
    }
  }, [note.id, router]);

  // Abre o arquivo de onde a nota nasceu. A URL assinada é pedida na hora e
  // aberta em outra aba — o bucket é privado, não há endereço público para
  // virar `href` (ver "A URL do arquivo" no AGENTS).
  const openAttachment = useCallback(async () => {
    if (!note.attachment) return;
    try {
      const response = await fetch(`/api/attachments/${note.attachment.id}`);
      const body = (await response.json().catch(() => null)) as {
        url?: string;
      } | null;
      if (response.ok && body?.url) {
        window.open(body.url, "_blank", "noopener,noreferrer");
      }
    } catch {
      // A referência continua visível mesmo quando o arquivo não abre.
    }
  }, [note.attachment]);

  return (
    // As variantes `print:` desmontam o chrome da tela na impressão: a página
    // é 100dvh com rolagem interna, e sem elas o PDF sairia com uma página só
    // — o recorte do que está visível no viewport.
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background print:h-auto print:overflow-visible">
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
                onSelect={deleteNote}
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

      <EditorToolbar
        editor={editor}
        className="print:hidden"
      />
      <EditorBubbleMenu editor={editor} />

      <div className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
        <div className="mx-auto w-full max-w-2xl px-6 pt-10 pb-12">
          <label className="sr-only" htmlFor="note-title">
            Título da nota
          </label>
          <input
            id="note-title"
            value={title}
            onChange={(event) => handleTitle(event.target.value)}
            placeholder="Sem título"
            maxLength={200}
            data-focus-ring="container"
            className="w-full rounded-lg bg-transparent text-3xl font-bold tracking-[-0.02em] text-foreground outline-none placeholder:text-subtle-foreground font-[family-name:var(--font-display)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-subtle-foreground sm:text-4xl"
          />

          {/* A referência de origem: de qual documento a Nexo derivou esta
              nota. Não leva `print:hidden` — a procedência é conteúdo, e faz
              sentido no PDF exportado. */}
          {note.attachment && (
            <button
              type="button"
              onClick={() => void openAttachment()}
              title="Abrir o arquivo de origem"
              className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-muted-foreground motion-reduce:transition-none"
            >
              <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                Derivada de{" "}
                <span className="font-medium text-muted-foreground">
                  {note.attachment.filename}
                </span>
              </span>
            </button>
          )}

          <NoteTags noteId={note.id} initialTags={note.tags} />

          {/* A tipografia do documento vive em `PROSE_EDITOR_CLASS`, por
              descendência: o conteúdo é gerado pelo ProseMirror e não passa
              pelas nossas classes um a um. Aqui só a altura e a margem, que
              são desta tela. */}
          <EditorContent
            editor={editor}
            style={{ zoom: textZoom.zoom / 100 }}
            className={cn("mt-8 [&_.tiptap]:min-h-[60vh]", PROSE_EDITOR_CLASS)}
          />
          <div className="mt-6 flex justify-end border-t border-border pt-3 print:hidden">
            <EditorZoomControls
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
