"use client";

import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link2,
  Strikethrough,
  Underline,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { LinkEditor } from "@/components/editor/link-editor";
import { HINTS } from "@/lib/editor/shortcuts";
import { cn } from "@/lib/utils";

/**
 * O menu que flutua sobre a seleção.
 *
 * É a única interface de formatação da janela de nota da lousa e do rascunho
 * do dashboard — as duas telas onde uma barra fixa seria peso a mais. O editor
 * inteiro também o mostra, por cima da barra: pega a seleção onde a mão já
 * está.
 *
 * `compact` (lousa, rascunho) mostra só as marcas de todo dia. O editor
 * inteiro (`compact` falso) soma sublinhado e tachado.
 *
 * Vai para o `body` com posição `fixed` de propósito: a moldura da lousa é
 * `overflow-clip`, e um menu preso ao editor sumiria pela borda.
 */
export function EditorBubbleMenu({
  editor,
  compact = false,
}: {
  editor: Editor | null;
  compact?: boolean;
}) {
  const [linkOpen, setLinkOpen] = useState(false);

  // `⌘K` abre o campo de link — mas só com texto selecionado, que é quando o
  // menu está na tela para ancorá-lo.
  useEffect(() => {
    if (!editor) return;

    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (!editor) return;
        if (editor.state.selection.empty) return;
        event.preventDefault();
        setLinkOpen(true);
      }
    }

    const dom = editor.view.dom;
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  // Some com o campo de link quando a seleção esvazia — o menu já saiu da
  // tela, e reabri-lo depois não deve cair direto no campo.
  useEffect(() => {
    if (!editor) return;
    function onSelect() {
      if (editor?.state.selection.empty) setLinkOpen(false);
    }
    editor.on("selectionUpdate", onSelect);
    return () => {
      editor.off("selectionUpdate", onSelect);
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      appendTo={() => document.body}
      options={{ strategy: "fixed", placement: "top" }}
      shouldShow={({ editor: current, state, from, to }) => {
        if (!current.isEditable || from === to) return false;
        if (current.isActive("codeBlock")) return false;
        if (state.selection instanceof NodeSelection) return false;
        return true;
      }}
    >
      <div className="flex items-center gap-0.5 rounded-xl border border-border bg-background p-1 shadow-lg">
        {linkOpen ? (
          <LinkEditor editor={editor} onClose={() => setLinkOpen(false)} />
        ) : (
          <>
            <MarkButton
              hint={HINTS.bold}
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="size-4" aria-hidden="true" />
            </MarkButton>
            <MarkButton
              hint={HINTS.italic}
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="size-4" aria-hidden="true" />
            </MarkButton>

            {!compact && (
              <>
                <MarkButton
                  hint={HINTS.underline}
                  active={editor.isActive("underline")}
                  onClick={() => editor.chain().focus().toggleUnderline().run()}
                >
                  <Underline className="size-4" aria-hidden="true" />
                </MarkButton>
                <MarkButton
                  hint={HINTS.strike}
                  active={editor.isActive("strike")}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                >
                  <Strikethrough className="size-4" aria-hidden="true" />
                </MarkButton>
              </>
            )}

            <MarkButton
              hint={HINTS.code}
              active={editor.isActive("code")}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code className="size-4" aria-hidden="true" />
            </MarkButton>
            <MarkButton
              hint={HINTS.highlight}
              active={editor.isActive("highlight")}
              onClick={() => editor.chain().focus().toggleHighlight().run()}
            >
              <Highlighter className="size-4" aria-hidden="true" />
            </MarkButton>

            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />

            <MarkButton
              hint={HINTS.link}
              active={editor.isActive("link")}
              onClick={() => setLinkOpen(true)}
            >
              <Link2 className="size-4" aria-hidden="true" />
            </MarkButton>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}

function MarkButton({
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
      // O `mousedown` do editor tiraria a seleção antes do `click` chegar.
      onMouseDown={(event) => event.preventDefault()}
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
