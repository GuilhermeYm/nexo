"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Check,
  ChevronDown,
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
import { type ReactNode, useCallback, useRef, useState } from "react";

import { FloatingPanel } from "@/components/editor/floating-panel";
import { LinkEditor } from "@/components/editor/link-editor";
import {
  NOTE_FONT_VARIABLES,
  noteFontFamily,
} from "@/components/editor/note-font-faces";
import {
  TextColorGlyph,
  TextColorSwatches,
  useActiveTextColor,
} from "@/components/editor/text-color-picker";
import {
  ShortcutTip,
  shortcutProps,
  useShortcutTip,
} from "@/components/editor/shortcut-tip";
import { NOTE_FONTS, type NoteFontId } from "@/lib/editor/note-fonts";
import { type Shortcut, SHORTCUTS } from "@/lib/editor/shortcuts";
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
  font,
  onFontChange,
  className,
}: {
  editor: Editor | null;
  /** A fonte do documento — é da nota, não da seleção. */
  font: NoteFontId;
  onFontChange: (font: NoteFontId) => void;
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
            <FontPicker font={font} onChange={onFontChange} />

            <Divider />

            <ToolbarButton
              shortcut={SHORTCUTS.bold}
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.italic}
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.underline}
              active={editor.isActive("underline")}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <Underline className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.strike}
              active={editor.isActive("strike")}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Strikethrough className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.code}
              active={editor.isActive("code")}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.highlight}
              active={editor.isActive("highlight")}
              onClick={() => editor.chain().focus().toggleHighlight().run()}
            >
              <Highlighter className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ColorButton editor={editor} />

            <Divider />

            <ToolbarButton
              shortcut={SHORTCUTS.heading1}
              active={editor.isActive("heading", { level: 1 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
            >
              <Heading1 className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.heading2}
              active={editor.isActive("heading", { level: 2 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              <Heading2 className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.heading3}
              active={editor.isActive("heading", { level: 3 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
            >
              <Heading3 className="size-4" aria-hidden="true" />
            </ToolbarButton>

            <Divider />

            <ToolbarButton
              shortcut={SHORTCUTS.bulletList}
              active={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.orderedList}
              active={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.taskList}
              active={editor.isActive("taskList")}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
            >
              <ListChecks className="size-4" aria-hidden="true" />
            </ToolbarButton>

            <Divider />

            <ToolbarButton
              shortcut={SHORTCUTS.blockquote}
              active={editor.isActive("blockquote")}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Quote className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.codeBlock}
              active={editor.isActive("codeBlock")}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            >
              <SquareCode className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.horizontalRule}
              active={false}
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
            >
              <Minus className="size-4" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              shortcut={SHORTCUTS.details}
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

      <ShortcutTip
        anchorRef={anchorRef}
        open={tip.open}
        onClose={tip.hide}
        shortcut={shortcut}
      />
    </>
  );
}

/**
 * O botão de link abre o mesmo `LinkEditor` do bubble menu, ancorado a ele.
 * Fecha no Esc, ao clicar fora e ao aplicar.
 */
function LinkButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // O mesmo botão ancora as duas coisas: a dica e o painel do link.
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tip = useShortcutTip<HTMLButtonElement>();

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-pressed={editor.isActive("link")}
        aria-expanded={open}
        {...shortcutProps(SHORTCUTS.link)}
        {...tip.handlers}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 pointer-coarse:size-10",
          editor.isActive("link")
            ? "bg-tertiary text-foreground"
            : "text-subtle-foreground hover:bg-tertiary hover:text-foreground"
        )}
      >
        <Link2 className="size-4" aria-hidden="true" />
        <span className="sr-only">{SHORTCUTS.link.label}</span>
      </button>

      {/* Com o painel aberto a dica sobraria: ela explicaria um botão que já
          virou outra coisa. */}
      <ShortcutTip
        anchorRef={anchorRef}
        open={tip.open && !open}
        onClose={tip.hide}
        shortcut={SHORTCUTS.link}
      />

      <FloatingPanel
        anchorRef={anchorRef}
        open={open}
        onClose={close}
        label="Link"
        className="py-1.5"
      >
        <LinkEditor editor={editor} onClose={close} />
      </FloatingPanel>
    </>
  );
}

/**
 * A cor do texto selecionado. O traço sob o "A" mostra a cor onde o cursor
 * está; o painel é a paleta inteira, com "padrão" primeiro para desfazer.
 */
const COLOR_TIP: Shortcut = { label: "Cor do texto", keys: [] };

function ColorButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const current = useActiveTextColor(editor);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tip = useShortcutTip<HTMLButtonElement>();
  const hint = "Cor do texto";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        aria-label={hint}
        aria-expanded={open}
        aria-haspopup="dialog"
        {...tip.handlers}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 pointer-coarse:size-10",
          open || current
            ? "bg-tertiary text-foreground"
            : "text-subtle-foreground hover:bg-tertiary hover:text-foreground"
        )}
      >
        <TextColorGlyph color={current} />
      </button>

      <ShortcutTip
        anchorRef={anchorRef}
        open={tip.open && !open}
        onClose={tip.hide}
        shortcut={COLOR_TIP}
      />

      <FloatingPanel
        anchorRef={anchorRef}
        open={open}
        onClose={close}
        label={hint}
        className="p-1"
      >
        <TextColorSwatches editor={editor} onPicked={close} />
      </FloatingPanel>
    </>
  );
}

/**
 * A fonte da nota inteira — do título ao PDF. Fica no começo da barra, antes
 * das marcas, porque não age sobre a seleção: é uma escolha do documento.
 * Cada opção se desenha na própria fonte; ver é mais rápido que ler o nome.
 */
const FONT_TIP: Shortcut = { label: "Fonte da nota", keys: [] };

function FontPicker({
  font,
  onChange,
}: {
  font: NoteFontId;
  onChange: (font: NoteFontId) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tip = useShortcutTip<HTMLButtonElement>();
  const current =
    NOTE_FONTS.find((option) => option.id === font) ?? NOTE_FONTS[0];

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Fonte da nota: ${current.name}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        {...tip.handlers}
        className={cn(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] transition-colors duration-150 pointer-coarse:h-10",
          open
            ? "bg-tertiary text-foreground"
            : "text-muted-foreground hover:bg-tertiary hover:text-foreground"
        )}
      >
        <span style={{ fontFamily: noteFontFamily(current.id) }}>
          {current.name}
        </span>
        <ChevronDown
          className="size-3.5 text-subtle-foreground"
          aria-hidden="true"
        />
      </button>

      <ShortcutTip
        anchorRef={anchorRef}
        open={tip.open && !open}
        onClose={tip.hide}
        shortcut={FONT_TIP}
      />

      <FloatingPanel
        anchorRef={anchorRef}
        open={open}
        onClose={close}
        label="Fonte da nota"
        // O painel vai para o `body`, fora de quem publica as `--font-note-*`.
        className={cn("w-64 p-1", NOTE_FONT_VARIABLES)}
      >
        <ul className="flex flex-col">
          {NOTE_FONTS.map((option) => {
            const selected = option.id === font;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onChange(option.id);
                    close();
                    anchorRef.current?.focus();
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-tertiary motion-reduce:transition-none",
                    selected && "bg-tertiary"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className="block text-[15px] leading-snug text-foreground"
                      style={{ fontFamily: noteFontFamily(option.id) }}
                    >
                      {option.name}
                    </span>
                    <span className="block text-xs text-subtle-foreground">
                      {option.hint}
                    </span>
                  </span>
                  {selected && (
                    <Check
                      className="size-4 shrink-0 text-foreground"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-1 border-t border-border px-2.5 pt-2 pb-1.5 text-xs leading-relaxed text-subtle-foreground">
          Vale para a nota inteira, e vai junto no PDF.
        </p>
      </FloatingPanel>
    </>
  );
}

function Divider() {
  return (
    <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
  );
}
