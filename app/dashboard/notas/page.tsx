import { redirect } from "next/navigation";

import { NotesView } from "@/components/notes/notes-view";
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

  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();

  return <NotesView initial={null} renderedAt={renderedAt} />;
}
