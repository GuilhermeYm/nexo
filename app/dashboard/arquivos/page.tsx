import { redirect } from "next/navigation";

import { FilesView } from "@/components/files/files-view";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Arquivos — Nexo",
};

export default async function FilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <FilesView />;
}
