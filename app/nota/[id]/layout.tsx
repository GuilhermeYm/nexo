import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/** Portão do editor. Mesma regra do dashboard e da lousa. */
export default async function NotaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return children;
}
