"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Barra de formatação do editor.
 *
 * Fixa e não flutuante sobre a seleção: numa primeira versão, ver o que
 * existe vale mais do que economizar o espaço da barra. O menu flutuante
 * entra depois, quando o vocabulário já for conhecido.
 *
 * Compartilhada entre a nota (`/nota/[id]`) e o rascunho do dashboard —
 * `className`/`innerClassName` acomodam a diferença de moldura: a nota tem
 * uma barra que atravessa a página, o rascunho tem uma faixa dentro do
 * cartão.
 */
export function EditorToolbar({
  editor,
  className,
  innerClassName,
}: {
  editor: Editor | null;
  className?: string;
  innerClassName?: string;
}) {
  // A moldura existe desde o primeiro paint mesmo sem editor. O TipTap só
  // monta no cliente (`immediatelyRender: false`), e sem esta reserva de
  // altura o documento inteiro saltaria para baixo quando ele chegasse.
  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center border-b border-border px-3 sm:px-4",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-2xl items-center gap-0.5 overflow-x-auto",
          innerClassName
        )}
      >
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
