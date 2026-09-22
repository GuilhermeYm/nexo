import { redirect } from "next/navigation";
import { z } from "zod";

import { NotesView } from "@/components/notes/notes-view";
import { createClient } from "@/lib/supabase/server";
import { listTagsWithUsage } from "@/lib/tags/queries";

export const metadata = {
  title: "Notas e pastas — Nexo",
};

// `?folder=` chega da barra lateral do dashboard: `none` ou o id de uma pasta.
// Qualquer outra coisa é ignorada — a lista abre em "Todas as pastas".
const folderParamSchema = z.union([z.literal("none"), z.string().uuid()]);

export default async function NotesPage({
  searchParams,
}: PageProps<"/dashboard/notas">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();

  const { folder } = await searchParams;
  const parsedFolder = folderParamSchema.safeParse(folder);
  const tagRows = await listTagsWithUsage(user.id);
  const tagVocabulary = tagRows.map(({ id, name, color }) => ({ id, name, color }));

  return (
    <NotesView
      initial={null}
      renderedAt={renderedAt}
      initialFolder={parsedFolder.success ? parsedFolder.data : "all"}
      tagVocabulary={tagVocabulary}
    />
  );
}
