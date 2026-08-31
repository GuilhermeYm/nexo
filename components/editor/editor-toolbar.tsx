"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Underline,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { LinkEditor } from "@/components/editor/link-editor";
import { HINTS } from "@/lib/editor/shortcuts";
import { cn } from "@/lib/utils";

/**
 * A barra de formatação fixa do editor de nota (`/nota/[id]`).
 *
 * É a tela feita para escrever de verdade, e ali ver o vocabulário inteiro
 * disposto vale o espaço da barra. O rascunho e a janela da lousa não têm
 * barra — usam só o bubble menu. O bubble menu também aparece aqui, por cima
 * da barra, para a formatação seguir a seleção.
 *
 * A moldura existe desde o primeiro paint mesmo sem `editor`: o TipTap só
 * monta no cliente (`immediatelyRender: false`), e sem esta reserva de altura
 * o documento saltaria para baixo quando ele chegasse.
 */
export function EditorToolbar({
  editor,
  className,
}: {
  editor: Editor | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center border-b border-border px-3 sm:px-4",
        className
      )}
    >
      <div className="mx-auto flex w-full max-w-2xl items-center gap-0.5 overflow-x-auto">
        {editor && (
          <>
            <ToolbarButton
              hint={HINTS.bold}
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.italic}
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.underline}
              active={editor.isActive("underline")}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <Underline className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.strike}
              active={editor.isActive("strike")}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Strikethrough className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.code}
              active={editor.isActive("code")}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.highlight}
              active={editor.isActive("highlight")}
              onClick={() => editor.chain().focus().toggleHighlight().run()}
            >
              <Highlighter className="size-4" aria-hidden="true" />
            </ToolbarButton>

            <Divider />

            <ToolbarButton
              hint={HINTS.heading1}
              active={editor.isActive("heading", { level: 1 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
            >
              <Heading1 className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.heading2}
              active={editor.isActive("heading", { level: 2 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              <Heading2 className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.heading3}
              active={editor.isActive("heading", { level: 3 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
            >
              <Heading3 className="size-4" aria-hidden="true" />
            </ToolbarButton>

            <Divider />

            <ToolbarButton
              hint={HINTS.bulletList}
              active={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.orderedList}
              active={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.taskList}
              active={editor.isActive("taskList")}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
            >
              <ListChecks className="size-4" aria-hidden="true" />
            </ToolbarButton>

            <Divider />

            <ToolbarButton
              hint={HINTS.blockquote}
              active={editor.isActive("blockquote")}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Quote className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.codeBlock}
              active={editor.isActive("codeBlock")}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            >
              <SquareCode className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.horizontalRule}
              active={false}
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
            >
              <Minus className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              hint={HINTS.details}
              active={editor.isActive("details")}
              onClick={() =>
                editor.isActive("details")
                  ? editor.chain().focus().unsetDetails().run()
                  : editor.chain().focus().setDetails().run()
              }
            >
              <ListTree className="size-4" aria-hidden="true" />
            </ToolbarButton>

            <Divider />

            <LinkButton editor={editor} />
          </>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  hint,
  active,
  onClick,
  children,
}: {
  hint: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 pointer-coarse:size-10",
        active
          ? "bg-tertiary text-foreground"
          : "text-subtle-foreground hover:bg-tertiary hover:text-foreground"
      )}
    >
      {children}
      <span className="sr-only">{hint}</span>
    </button>
  );
}

/**
 * O botão de link abre o mesmo `LinkEditor` do bubble menu, ancorado a ele.
 * Fecha no Esc, ao clicar fora e ao aplicar.
 */
function LinkButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(event: PointerEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onOutside, true);
    return () => document.removeEventListener("pointerdown", onOutside, true);
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={HINTS.link}
        aria-pressed={editor.isActive("link")}
        aria-expanded={open}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 pointer-coarse:size-10",
          editor.isActive("link")
            ? "bg-tertiary text-foreground"
            : "text-subtle-foreground hover:bg-tertiary hover:text-foreground"
        )}
      >
        <Link2 className="size-4" aria-hidden="true" />
        <span className="sr-only">{HINTS.link}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 rounded-xl border border-border bg-background py-1.5 shadow-lg">
          <LinkEditor editor={editor} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function Divider() {
  return (
    <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
  );
}
