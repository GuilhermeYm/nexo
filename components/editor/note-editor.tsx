"use client";

import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  ArrowLeft,
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  LayoutGrid,
  List,
  ListOrdered,
  Quote,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  NOTE_TYPE_LABEL,
  NoteTypeIcon,
} from "@/components/dashboard/note-type-icon";
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
import type { WorkspaceSummary } from "@/lib/dashboard/queries";
import { plainToRichDocument } from "@/lib/editor/document";
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
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          HTMLAttributes: {
            rel: "noreferrer noopener",
            target: "_blank",
          },
        },
      }),
      Placeholder.configure({
        placeholder: "Escreva. A Nexo guarda sozinha.",
      }),
    ],
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

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2.5 sm:px-4">
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

      <Toolbar editor={editor} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 pt-10 pb-32">
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

          {note.tags.length > 0 && (
            <ul className="mt-4 flex flex-wrap items-center gap-1.5">
              {note.tags.map((tag) => (
                <li
                  key={tag.id}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    TAG_TONE[tag.color ?? ""] ??
                      "bg-secondary text-muted-foreground"
                  )}
                >
                  #{tag.name}
                </li>
              ))}
            </ul>
          )}

          {/* A tipografia do documento vive aqui, por descendência: o
              conteúdo do editor é gerado pelo ProseMirror e não passa pelas
              nossas classes um a um. */}
          <EditorContent
            editor={editor}
            className={[
              "mt-8",
              "[&_.tiptap]:min-h-[60vh] [&_.tiptap]:text-[15px] [&_.tiptap]:leading-[1.75] [&_.tiptap]:text-muted-foreground",
              "[&_h1]:mt-8 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-[-0.01em] [&_h1]:text-foreground [&_h1]:font-[family-name:var(--font-display)]",
              "[&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-foreground [&_h2]:font-[family-name:var(--font-display)]",
              "[&_h3]:mt-6 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-foreground",
              "[&_p]:my-3",
              "[&_strong]:font-semibold [&_strong]:text-foreground",
              "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
              "[&_blockquote]:my-4 [&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-foreground [&_blockquote]:italic",
              "[&_code]:rounded [&_code]:bg-tertiary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-foreground",
              "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-secondary [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[13px]",
              "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
              "[&_hr]:my-8 [&_hr]:border-border",
              "[&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4",
              // O placeholder do TipTap é um pseudo-elemento no primeiro
              // parágrafo vazio.
              "[&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-subtle-foreground [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
            ].join(" ")}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

const TAG_TONE: Record<string, string> = {
  "1": "bg-tag-1 text-tag-1-foreground",
  "2": "bg-tag-2 text-tag-2-foreground",
  "3": "bg-tag-3 text-tag-3-foreground",
  "4": "bg-tag-4 text-tag-4-foreground",
  "5": "bg-tag-5 text-tag-5-foreground",
  "6": "bg-tag-6 text-tag-6-foreground",
};

/**
 * Barra de formatação fixa.
 *
 * Fixa e não flutuante sobre a seleção: numa primeira versão, ver o que
 * existe vale mais do que economizar o espaço da barra. O menu flutuante
 * entra depois, quando o vocabulário já for conhecido.
 */
function Toolbar({ editor }: { editor: Editor | null }) {
  // A moldura existe desde o primeiro paint mesmo sem editor. O TipTap só
  // monta no cliente (`immediatelyRender: false`), e sem esta reserva de
  // altura o documento inteiro saltaria para baixo quando ele chegasse.
  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border px-3 sm:px-4">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-0.5 overflow-x-auto">
        {editor && (
          <>
            <ToolbarButton
              label="Negrito"
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              label="Itálico"
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              label="Código"
              active={editor.isActive("code")}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code className="size-4" aria-hidden="true" />
            </ToolbarButton>

            <Divider />

            <ToolbarButton
              label="Título"
              active={editor.isActive("heading", { level: 1 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
            >
              <Heading1 className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              label="Subtítulo"
              active={editor.isActive("heading", { level: 2 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              <Heading2 className="size-4" aria-hidden="true" />
            </ToolbarButton>

            <Divider />

            <ToolbarButton
              label="Lista"
              active={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              label="Lista numerada"
              active={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              label="Citação"
              active={editor.isActive("blockquote")}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Quote className="size-4" aria-hidden="true" />
            </ToolbarButton>
          </>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-pressed={active}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 pointer-coarse:size-10",
        active
          ? "bg-tertiary text-foreground"
          : "text-subtle-foreground hover:bg-tertiary hover:text-foreground"
      )}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function Divider() {
  return (
    <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
  );
}

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
