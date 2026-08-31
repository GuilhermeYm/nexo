"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect } from "react";

import { EditorBubbleMenu } from "@/components/editor/editor-bubble-menu";
import { plainToRichDocument, richTextToPlain } from "@/lib/editor/document";
import { buildEditorExtensions } from "@/lib/editor/extensions";
import { PROSE_EDITOR_CLASS } from "@/lib/editor/prose-classes";
import { cn } from "@/lib/utils";

/**
 * O corpo de uma janela de nota da lousa — o mesmo TipTap das outras telas,
 * na moldura mais apertada que existe.
 *
 * **Sem barra fixa.** Uma lousa com dez janelas não pode ter dez barras de
 * formatação; a formatação vem pelo bubble menu sobre a seleção, pelos input
 * rules (` ``` `, `-`, `1.`, `---`) e pelos atalhos. O menu "/" fica de fora
 * (`slash: false`): uma lista larga numa janela de 340px seria um estorvo.
 *
 * **O que é salvo.** O documento (`contentRich`); o texto puro que alimenta a
 * busca é derivado dele — aqui no cliente para o eco local, e de novo no
 * servidor, que é a autoridade (mesma regra do `PATCH /api/notes/[id]`).
 *
 * Entra por `next/dynamic` lá no `window-bodies.tsx`: o ProseMirror é a peça
 * mais pesada do cliente, e uma lousa só de post-its e PDFs não deve baixá-lo.
 */
export function NoteWindowEditor({
  content,
  contentRich,
  autoFocus,
  onChange,
}: {
  content: string | null;
  contentRich: unknown;
  /** Foi criada agora: o corpo entra em edição depois do título. */
  autoFocus: boolean;
  onChange: (patch: { content: string; contentRich: unknown }) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: buildEditorExtensions({
      placeholder: "Escreva aqui. A Nexo guarda sozinha.",
      slash: false,
    }),
    // `??` e não `||`: um documento vazio válido não deve cair no texto puro.
    content: contentRich ?? plainToRichDocument(content ?? ""),
    editorProps: {
      attributes: {
        class: "outline-none",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Conteúdo da nota",
        // Âncora estável para os roteiros de ponta a ponta.
        "data-note-editor": "",
        // A moldura da janela desenha o foco; o anel padrão (outline com 2px
        // de folga) bateria na borda arredondada da janela.
        "data-focus-ring": "container",
      },
    },
    onUpdate: ({ editor: current }) => {
      const doc = current.getJSON();
      onChange({ contentRich: doc, content: richTextToPlain(doc) });
    },
  });

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus("end");
  }, [autoFocus, editor]);

  return (
    <div className="flex h-full min-h-0 flex-col px-2.5 pb-2.5">
      <EditorBubbleMenu editor={editor} compact />
      <EditorContent
        editor={editor}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-1 py-1 [&_.tiptap]:min-h-full",
          PROSE_EDITOR_CLASS
        )}
      />
    </div>
  );
}
