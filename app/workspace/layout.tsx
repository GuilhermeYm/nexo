import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Portão da lousa.
 *
 * Mesma regra do dashboard: o `proxy.ts` só refresca a sessão; autorização
 * acontece aqui e na RLS. `getUser()` valida o JWT no servidor do Supabase,
 * ao contrário de `getSession()`, que confia no cookie.
 */
export default async function WorkspaceLayout({
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
