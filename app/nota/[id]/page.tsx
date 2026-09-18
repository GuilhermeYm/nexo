import { notFound, redirect } from "next/navigation";

import { NoteEditor } from "@/components/editor/note-editor";
import { listWorkspaces } from "@/lib/dashboard/queries";
import { getNoteAiView } from "@/lib/notes/ai-view";
import { getOwnedNote } from "@/lib/notes/queries";
import { createClient } from "@/lib/supabase/server";

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
  const [note, workspaces, ai] = await Promise.all([
    getOwnedNote(user.id, id),
    listWorkspaces(user.id),
    getNoteAiView(user.id, id),
  ]);

  if (!note) notFound();

  return <NoteEditor note={note} workspaces={workspaces} ai={ai} />;
}
