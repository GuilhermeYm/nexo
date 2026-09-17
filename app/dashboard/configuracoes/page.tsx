import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { SettingsView } from "@/components/settings/settings-view";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { listOwnErrorReports } from "@/lib/errors/queries";
import { createClient } from "@/lib/supabase/server";
import { getUsageSnapshot } from "@/lib/usage/queries";

export const metadata = {
  title: "Configurações — Nexo",
};

export default async function ConfiguracoesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // O layout de /dashboard já barrou, mas a página não assume nada sobre isso.
  if (!user) redirect("/login");

  const [profileRows, usage, errorReports] = await Promise.all([
    db
      .select({
        displayName: profiles.displayName,
        createdAt: profiles.createdAt,
      })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
    getUsageSnapshot(user.id),
    listOwnErrorReports(user.id),
  ]);

  const profile = profileRows[0];

  return (
    <SettingsView
      userId={user.id}
      userName={profile?.displayName ?? null}
      userEmail={user.email ?? ""}
      // Date não atravessa a fronteira Server → Client; ISO atravessa.
      memberSince={profile?.createdAt?.toISOString() ?? null}
      usage={usage}
      errorReports={errorReports}
    />
  );
}
