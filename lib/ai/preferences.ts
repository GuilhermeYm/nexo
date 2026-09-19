import "server-only";

import { eq } from "drizzle-orm";

import {
  DEFAULT_AI_PREFERENCES,
  type AiPreferences,
} from "@/lib/ai/preference-options";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";

/**
 * As preferências de IA da pessoa. Sem perfil (conta recém-criada numa
 * corrida com a trigger), valem as padrão — nunca uma falha.
 */
export async function getAiPreferences(userId: string): Promise<AiPreferences> {
  const [row] = await db
    .select({
      reasoningEffort: profiles.aiReasoningEffort,
      limitNotice: profiles.aiLimitNotice,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return row ?? DEFAULT_AI_PREFERENCES;
}
