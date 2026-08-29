import { redirect } from "next/navigation";

import { TagsView } from "@/components/tags/tags-view";
import { createClient } from "@/lib/supabase/server";
import { listTagsWithUsage } from "@/lib/tags/queries";

export const metadata = {
  title: "Tags — Nexo",
};

export default async function TagsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // O layout de /dashboard já barrou, mas a página não assume nada sobre isso.
  if (!user) redirect("/login");

  const tags = await listTagsWithUsage(user.id);

  // Mesmo padrão do dashboard: este instante pinta o primeiro estado nos
  // dois lados (servidor e hidratação); depois o relógio do cliente assume.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();

  return <TagsView tags={tags} renderedAt={renderedAt} />;
}
