"use client";

import type { Editor } from "@tiptap/react";
import { Check } from "lucide-react";

import {
  activeTextColor,
  TEXT_COLORS,
  type TextColorId,
} from "@/lib/editor/text-color";
import { cn } from "@/lib/utils";

/**
 * O "A" sublinhado com a cor ativa — o ícone do botão de cor, na barra e no
 * bubble menu. Sem cor, o traço é da cor do próprio ícone.
 */
export function TextColorGlyph({ color }: { color: TextColorId | null }) {
  return (
    <span aria-hidden="true" className="flex flex-col items-center">
      <span className="text-[13px] leading-none font-semibold">A</span>
      <span
        className="mt-[3px] h-[3px] w-3.5 rounded-full bg-current"
        style={color ? { background: `var(--nx-ink-${color})` } : undefined}
      />
    </span>
  );
}

/** A cor da seleção, lida do editor. */
export function useActiveTextColor(editor: Editor): TextColorId | null {
  return activeTextColor(editor.getAttributes("textColor"));
}

/**
 * As amostras da paleta. Cada uma é um "A" pintado na cor — o que se vê é o
 * que o texto vai ficar, nos dois temas —, com o nome no `title` e para
 * leitores de tela, porque cor sozinha não é rótulo.
 */
export function TextColorSwatches({
  editor,
  onPicked,
}: {
  editor: Editor;
  onPicked?: () => void;
}) {
  const current = activeTextColor(editor.getAttributes("textColor"));

  function pick(color: TextColorId | null) {
    const chain = editor.chain().focus();
    if (color) chain.setTextColor(color).run();
    else chain.unsetTextColor().run();
    onPicked?.();
  }

  return (
    <div
      className="flex items-center gap-0.5"
      role="group"
      aria-label="Cor do texto"
    >
      <Swatch
        name="Cor padrão"
        active={current === null}
        onPick={() => pick(null)}
      >
        <span className="text-[13px] font-semibold text-foreground">A</span>
      </Swatch>
      {TEXT_COLORS.map((color) => (
        <Swatch
          key={color.id}
          name={color.name}
          active={current === color.id}
          onPick={() => pick(color.id)}
        >
          <span
            className="text-[13px] font-semibold"
            style={{ color: `var(--nx-ink-${color.id})` }}
          >
            A
          </span>
        </Swatch>
      ))}
    </div>
  );
}

function Swatch({
  name,
  active,
  onPick,
  children,
}: {
  name: string;
  active: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // O `mousedown` do editor tiraria a seleção antes do `click` chegar.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      title={name}
      aria-pressed={active}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-tertiary motion-reduce:transition-none pointer-coarse:size-10",
        active && "bg-tertiary"
      )}
    >
      {children}
      {active && (
        <Check
          aria-hidden="true"
          className="absolute right-0.5 bottom-0.5 size-2.5 text-subtle-foreground"
        />
      )}
      <span className="sr-only">{name}</span>
    </button>
  );
}
