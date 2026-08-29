import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Portão do dashboard.
 *
 * O `proxy.ts` refresca a sessão, mas autorização de verdade acontece aqui e
 * na RLS — nunca só no proxy. `getUser()` valida o JWT no servidor do
 * Supabase, ao contrário de `getSession()`, que confia no cookie.
 */
export default async function DashboardLayout({
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
