"use client";

import type { Editor } from "@tiptap/react";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * O campo que escreve o `href` de um link.
 *
 * A marca `Link` já vem na `StarterKit`, mas não havia como criar uma. Este
 * campo aparece no bubble menu e na barra fixa, e os dois o usam igual: um
 * `input` com a URL atual, Enter aplica, campo vazio remove, Esc fecha.
 * Mesmo formato do `TagEditor` da janela da lousa.
 */
export function LinkEditor({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [value, setValue] = useState(
    () => (editor.getAttributes("link").href as string | undefined) ?? ""
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, []);

  function apply() {
    const href = value.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) {
      chain.setLink({ href }).run();
    } else {
      chain.unsetLink().run();
    }
    onClose();
  }

  return (
    <div className="flex items-center gap-1 px-1">
      <input
        ref={inputRef}
        type="url"
        inputMode="url"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        placeholder="https://…"
        className="h-7 w-52 rounded-md bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-subtle-foreground"
      />
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={apply}
        title={value.trim() ? "Aplicar o link" : "Remover o link"}
        className="grid size-7 shrink-0 place-items-center rounded-md text-subtle-foreground transition-colors duration-100 hover:bg-tertiary hover:text-foreground"
      >
        {value.trim() ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <X className="size-3.5" aria-hidden="true" />
        )}
        <span className="sr-only">
          {value.trim() ? "Aplicar o link" : "Remover o link"}
        </span>
      </button>
    </div>
  );
}
