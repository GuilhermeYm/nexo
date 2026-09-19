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
import { type ReactNode, useEffect, useRef, useState } from "react";

import { LinkEditor } from "@/components/editor/link-editor";
import {
  ShortcutTip,
  shortcutProps,
  useShortcutTip,
} from "@/components/editor/shortcut-tip";
import {
  TextColorGlyph,
  TextColorSwatches,
  useActiveTextColor,
} from "@/components/editor/text-color-picker";
import { type Shortcut, SHORTCUTS } from "@/lib/editor/shortcuts";
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
  // A paleta troca o conteúdo do menu, como o campo de link: um painel a
  // mais flutuando sobre um menu que já flutua seria uma pilha frágil.
  const [colorOpen, setColorOpen] = useState(false);

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
      if (editor?.state.selection.empty) {
        setLinkOpen(false);
        setColorOpen(false);
      }
    }
    editor.on("selectionUpdate", onSelect);
    return () => {
      editor.off("selectionUpdate", onSelect);
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <BubbleMenuBody
      editor={editor}
      compact={compact}
      linkOpen={linkOpen}
      setLinkOpen={setLinkOpen}
      colorOpen={colorOpen}
      setColorOpen={setColorOpen}
    />
  );
}

/**
 * O menu em si. Separado para ler a cor ativa com o `editor` já garantido —
 * um hook não pode vir depois do `return null` acima.
 */
function BubbleMenuBody({
  editor,
  compact,
  linkOpen,
  setLinkOpen,
  colorOpen,
  setColorOpen,
}: {
  editor: Editor;
  compact: boolean;
  linkOpen: boolean;
  setLinkOpen: (open: boolean) => void;
  colorOpen: boolean;
  setColorOpen: (open: boolean) => void;
}) {
  const textColor = useActiveTextColor(editor);

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
      {/* `print:hidden`: o menu vive no `body`, fora do chrome que já some na
          impressão — com texto selecionado, ia parar no PDF. */}
      <div className="flex items-center gap-0.5 rounded-xl border border-border bg-background p-1 shadow-lg print:hidden">
        {linkOpen ? (
          <LinkEditor editor={editor} onClose={() => setLinkOpen(false)} />
        ) : colorOpen ? (
          <TextColorSwatches
            editor={editor}
            onPicked={() => setColorOpen(false)}
          />
        ) : (
          <>
            <MarkButton
              shortcut={SHORTCUTS.bold}
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="size-4" aria-hidden="true" />
            </MarkButton>
            <MarkButton
              shortcut={SHORTCUTS.italic}
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="size-4" aria-hidden="true" />
            </MarkButton>

            {!compact && (
              <>
                <MarkButton
                  shortcut={SHORTCUTS.underline}
                  active={editor.isActive("underline")}
                  onClick={() => editor.chain().focus().toggleUnderline().run()}
                >
                  <Underline className="size-4" aria-hidden="true" />
                </MarkButton>
                <MarkButton
                  shortcut={SHORTCUTS.strike}
                  active={editor.isActive("strike")}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                >
                  <Strikethrough className="size-4" aria-hidden="true" />
                </MarkButton>
              </>
            )}

            <MarkButton
              shortcut={SHORTCUTS.code}
              active={editor.isActive("code")}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code className="size-4" aria-hidden="true" />
            </MarkButton>
            <MarkButton
              shortcut={SHORTCUTS.highlight}
              active={editor.isActive("highlight")}
              onClick={() => editor.chain().focus().toggleHighlight().run()}
            >
              <Highlighter className="size-4" aria-hidden="true" />
            </MarkButton>
            <MarkButton
              shortcut={COLOR_TIP}
              active={textColor !== null}
              onClick={() => setColorOpen(true)}
            >
              <TextColorGlyph color={textColor} />
            </MarkButton>

            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />

            <MarkButton
              shortcut={SHORTCUTS.link}
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

/** A cor não tem tecla; a dica mostra só o nome, no mesmo desenho. */
const COLOR_TIP: Shortcut = { label: "Cor do texto", keys: [] };

function MarkButton({
  shortcut,
  active,
  onClick,
  children,
}: {
  shortcut: Shortcut;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tip = useShortcutTip<HTMLButtonElement>();

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        // O `mousedown` do editor tiraria a seleção antes do `click` chegar.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        aria-pressed={active}
        {...shortcutProps(shortcut)}
        {...tip.handlers}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 pointer-coarse:size-10",
          active
            ? "bg-tertiary text-foreground"
            : "text-subtle-foreground hover:bg-tertiary hover:text-foreground"
        )}
      >
        {children}
        <span className="sr-only">{shortcut.label}</span>
      </button>

      {/* Acima: o menu já está sobre a seleção, e uma dica embaixo cairia
          justamente sobre o texto que a pessoa está formatando. */}
      <ShortcutTip
        anchorRef={anchorRef}
        open={tip.open}
        onClose={tip.hide}
        shortcut={shortcut}
        placement="top"
      />
    </>
  );
}
