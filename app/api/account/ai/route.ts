import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { LIMIT_NOTICES, REASONING_EFFORTS } from "@/lib/ai/preference-options";
import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const aiPreferencesSchema = z
  .object({
    reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    limitNotice: z.enum(LIMIT_NOTICES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nada para atualizar.",
  });

/**
 * Preferências de IA da conta — Configurações → IA.
 *
 * Pela rota e não pelo PostgREST: `profiles` só tem GRANT de UPDATE em
 * `display_name` e `avatar_url` (0005), e é assim que tem de ficar. Campo a
 * campo, listas fechadas no Zod e no CHECK de 0025.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `account:ai:${user.id}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas alterações seguidas. Aguarde um pouco.");
    }

    const parsed = aiPreferencesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }
    const input = parsed.data;

    const [updated] = await db
      .update(profiles)
      .set({
        ...(input.reasoningEffort && { aiReasoningEffort: input.reasoningEffort }),
        ...(input.limitNotice && { aiLimitNotice: input.limitNotice }),
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, user.id))
      .returning({
        reasoningEffort: profiles.aiReasoningEffort,
        limitNotice: profiles.aiLimitNotice,
      });

    if (!updated) return errorResponse(404, "Perfil não encontrado.");
    return NextResponse.json({ preferences: updated });
  } catch (error) {
    const code = await logServerError("PATCH /api/account/ai", error, { userId }, request);
    return errorResponse(500, "Erro ao salvar a preferência.", code);
  }
}
