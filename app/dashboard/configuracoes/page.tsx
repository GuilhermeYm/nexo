import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { SettingsView } from "@/components/settings/settings-view";
import { resolveProvider } from "@/lib/ai/classify-document";
import { MAX_RUNS_PER_DAY } from "@/lib/ai/note-reading";
import { supportsReasoningEffort } from "@/lib/ai/preference-options";
import { getAiPreferences } from "@/lib/ai/preferences";
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

  const [profileRows, usage, errorReports, aiPreferences] = await Promise.all([
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
    getAiPreferences(user.id),
  ]);

  // Só nome e modelo — a chave nunca sai do servidor.
  const provider = resolveProvider();
  const aiModel = provider
    ? {
        provider: provider.name,
        model: provider.model,
        reasoning: supportsReasoningEffort(provider.model),
      }
    : null;

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
      aiPreferences={aiPreferences}
      aiModel={aiModel}
      aiDailyReads={MAX_RUNS_PER_DAY}
    />
  );
}
