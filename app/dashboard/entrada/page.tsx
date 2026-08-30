import { redirect } from "next/navigation";

import { InboxView } from "@/components/inbox/inbox-view";
import {
  countUnreadNotifications,
  listNotifications,
} from "@/lib/inbox/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Entrada — Nexo",
};

/**
 * Página da Entrada.
 *
 * O primeiro estado vem do servidor: a lista de notificações e a contagem de
 * não lidas. O cliente assume depois, permitindo marcar como lida/não lida sem
 * recarregar a página.
 */
export default async function EntradaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [notifications, unreadCount] = await Promise.all([
    listNotifications(user.id),
    countUnreadNotifications(user.id),
  ]);

  return (
    <InboxView initial={notifications} initialUnreadCount={unreadCount} />
  );
}
