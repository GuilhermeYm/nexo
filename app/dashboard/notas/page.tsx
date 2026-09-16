import { redirect } from "next/navigation";

import { NotesView } from "@/components/notes/notes-view";
import { listOwnedNotes } from "@/lib/notes/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Notas — Nexo",
};

export default async function NotesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const initial = await listOwnedNotes(user.id);
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();

  return <NotesView initial={initial} renderedAt={renderedAt} />;
}
