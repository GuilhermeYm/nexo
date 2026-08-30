"use client";

import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { EditorToolbar } from "@/components/editor/editor-toolbar";
import { plainToRichDocument } from "@/lib/editor/document";
import { PROSE_EDITOR_CLASS } from "@/lib/editor/prose-classes";
import { cn } from "@/lib/utils";

/**
 * O corpo do rascunho — o mesmo editor da nota, sem o autosave.
 *
 * O rascunho é a única coisa da Nexo que não grava sozinha (ver
 * `useLocalDraft`), então este componente não fala com o servidor: ele só
 * devolve o documento a cada tecla, e quem persiste no `localStorage` é o
 * `DraftNote`.
 *
 * Entra por `next/dynamic` no `DraftNote`: o ProseMirror é a peça mais pesada
 * do cliente, e quem abre o dashboard só para capturar não deve baixá-lo até
 * abrir o rascunho de fato.
 */

interface DraftEditorProps {
  /** O documento guardado, ou `null` num rascunho que só tem texto puro. */
  initialDoc: unknown | null;
  /** Texto puro para montar o documento na primeira abertura. */
  plainFallback: string;
  /** Chamado a cada alteração com o documento do editor. */
  onChange: (doc: unknown) => void;
  /** Quando verdadeiro, o editor ocupa quase toda a viewport. */
  expanded?: boolean;
}

export function DraftEditor({
  initialDoc,
  plainFallback,
  onChange,
  expanded = false,
}: DraftEditorProps) {
  const editor = useEditor({
    // Obrigatório no App Router: renderizar já no servidor produz HTML que
    // não bate com o do cliente e a hidratação quebra.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          HTMLAttributes: { rel: "noreferrer noopener", target: "_blank" },
        },
      }),
      Placeholder.configure({
        placeholder:
          "Escreva à vontade. Nada daqui sai do seu navegador até você mandar.",
      }),
    ],
    // O `??` e não `||`: um documento vazio válido (`{type:"doc",...}`) é um
    // começo legítimo e não deve cair no texto puro.
    content: initialDoc ?? plainToRichDocument(plainFallback),
    editorProps: {
      attributes: {
        // `#draft-content` é o alvo dos roteiros de ponta a ponta.
        id: "draft-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Texto do rascunho",
        class: "outline-none",
        "data-focus-ring": "container",
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON()),
  });

  return (
    <div className="mt-1 border-t border-border">
      <EditorToolbar
        editor={editor}
        className="h-10 border-b-0 px-1 sm:px-1"
        innerClassName="max-w-none"
      />
      {/* Altura e rolagem são desta tela; a tipografia vem compartilhada. */}
      <EditorContent
        editor={editor}
        className={cn(
          "overflow-y-auto px-2.5 pt-1 pb-2.5 [&_.tiptap]:min-h-[7rem]",
          expanded
            ? "max-h-[calc(100vh-15rem)]"
            : "max-h-[46vh]",
          PROSE_EDITOR_CLASS
        )}
      />
    </div>
  );
}
