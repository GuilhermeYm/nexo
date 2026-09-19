import { notFound, redirect } from "next/navigation";

import { NoteEditor } from "@/components/editor/note-editor";
import { listWorkspaces } from "@/lib/dashboard/queries";
import { listFolders } from "@/lib/folders/queries";
import { getNoteAiView } from "@/lib/notes/ai-view";
import { getOwnedNote } from "@/lib/notes/queries";
import { createClient } from "@/lib/supabase/server";
import { listTagsWithUsage } from "@/lib/tags/queries";

export const metadata = {
  title: "Nota — Nexo",
};

/** O `id` vem da URL. Antes de virar comparação com uma coluna uuid, é texto. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O editor de uma nota.
 *
 * Rota própria e não sobreposição: o editor carrega o ProseMirror junto, é a
 * peça mais pesada do cliente, e não tem por que entrar no dashboard de quem
 * só veio capturar. A janela da lousa continua com o campo de texto simples,
 * que é leve e serve para escrever no meio do arranjo.
 */
export default async function NotaPage(props: PageProps<"/nota/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // 404 e não 403 quando a nota é de outra pessoa: confirmar que ela existe
  // já seria vazar informação.
  const [note, workspaces, ai, tagRows, folderRows] = await Promise.all([
    getOwnedNote(user.id, id),
    listWorkspaces(user.id),
    getNoteAiView(user.id, id),
    listTagsWithUsage(user.id),
    listFolders(user.id),
  ]);

  if (!note) notFound();

  // Só o que as sugestões precisam — contagem e datas ficam no servidor.
  const tagVocabulary = tagRows.map(({ id: tagId, name, color }) => ({
    id: tagId,
    name,
    color,
  }));

  // As pastas, para trocar a da nota ali mesmo na ficha.
  const folderChoices = folderRows.map(({ id: folderId, name }) => ({
    id: folderId,
    name,
  }));

  return (
    <NoteEditor
      note={note}
      workspaces={workspaces}
      ai={ai}
      tagVocabulary={tagVocabulary}
      folders={folderChoices}
    />
  );
}
