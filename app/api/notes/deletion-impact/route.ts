import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { getNoteDeletionImpact, listFolderNoteIds } from "@/lib/notes/queries";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * O alvo: uma seleção de notas, ou uma pasta inteira.
 *
 * A pasta não vem como lista de ids porque quem pergunta é o trilho, que só
 * carregou as primeiras notas dela — mandar o que ele tem em mãos mediria o
 * impacto errado. O servidor resolve as notas da pasta com o mesmo critério
 * que a contagem usa, então a conta bate com o número que a pessoa viu.
 */
const impactSchema = z.union([
  z.object({
    ids: z.array(z.string().uuid()).min(1).max(100).refine(
      (ids) => new Set(ids).size === ids.length,
      "As notas selecionadas são inválidas."
    ),
  }),
  z.object({ folderId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `notes:deletion-impact:${user.id}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas consultas seguidas. Aguarde um pouco.");
    }

    const parsed = impactSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Notas selecionadas inválidas."
      );
    }

    const ids =
      "ids" in parsed.data
        ? parsed.data.ids
        : await listFolderNoteIds(user.id, parsed.data.folderId);
    // Pasta vazia (ou de outra conta) não tem impacto nenhum a relatar.
    const impact =
      ids.length === 0
        ? { attachmentCount: 0, tags: [] }
        : await getNoteDeletionImpact(user.id, ids);
    return NextResponse.json(impact, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const code = await logServerError(
      "POST /api/notes/deletion-impact",
      error,
      { userId },
      request
    );
    return errorResponse(500, "Erro ao verificar o impacto da exclusão.", code);
  }
}
