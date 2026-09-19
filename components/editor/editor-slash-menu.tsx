"use client";

import type { Editor, Range } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Keycaps } from "@/components/editor/shortcut-tip";
import type { Shortcut } from "@/lib/editor/shortcuts";
import { cn } from "@/lib/utils";

/**
 * A lista do menu "/".
 *
 * Só a interface: o motor (o `@tiptap/suggestion`) vive em
 * `lib/editor/slash-command.ts`, que monta este componente pelo `ReactRenderer`
 * e o posiciona sozinho (a API `mount` do suggestion v3 portaliza no `body` e
 * ancora no cursor — nada de floating-ui à mão, e sem esbarrar no
 * `overflow-clip` da moldura da lousa).
 *
 * O `ref` expõe `onKeyDown` porque a navegação por seta acontece enquanto o
 * foco continua no editor: o suggestion intercepta a tecla e pergunta a este
 * componente se ele a consumiu.
 */

export interface SlashItem {
  title: string;
  /** O atalho equivalente, quando existe — desenhado em teclas à direita. */
  shortcut?: Shortcut;
  keywords: string[];
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
}

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashMenuListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export const SlashMenuList = forwardRef<SlashMenuHandle, SlashMenuListProps>(
  function SlashMenuList({ items, command }, ref) {
    const [active, setActive] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    // A cada nova filtragem o cursor volta ao topo — senão ele fica apontando
    // para um item que a lista encolhida não tem mais.
    useEffect(() => setActive(0), [items]);

    // Mantém o item ativo à vista quando a navegação passa da borda.
    useLayoutEffect(() => {
      const node = listRef.current?.children[active] as HTMLElement | undefined;
      node?.scrollIntoView({ block: "nearest" });
    }, [active]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (items.length === 0) return false;

        if (event.key === "ArrowUp") {
          setActive((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setActive((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = items[active];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="w-72 rounded-xl border border-border bg-background p-3 text-xs text-subtle-foreground shadow-lg">
          Nenhum bloco com esse nome.
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        role="listbox"
        className="max-h-72 w-72 overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-lg"
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              // `mousedown` e não `click`: o `click` vem depois do `blur` do
              // editor, e aí o `range` da inserção já se perdeu.
              onMouseDown={(event) => {
                event.preventDefault();
                command(item);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-100 motion-reduce:transition-none",
                index === active
                  ? "bg-tertiary text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <Icon
                className="size-4 shrink-0 text-subtle-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {/* Só as teclas: o nome da ação já é o título da linha. */}
              {item.shortcut && (
                <Keycaps shortcut={item.shortcut} className="shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    );
  }
);
