import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { invalidateNoteListCache } from "@/lib/notes/cache";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { deleteOrphanTags } from "@/lib/tags/orphans";

/**
 * Apagar de uma vez as tags sem notas que a pessoa revisou.
 *
 * O corpo traz os ids que estavam **na tela** — não "apague todas as órfãs".
 * Quem confirma precisa ter visto o que sai: uma tag que ficou sem notas
 * depois que a lista carregou não entra no lote. E o servidor confere de novo
 * (`deleteOrphanTags`): a que ganhou uma nota nesse meio-tempo também fica.
 * A resposta diz quais saíram, para a tela tirar só essas.
 *
 * Nenhuma nota perde tag aqui — por definição, nenhuma nota viva usava estas.
 * O `ON DELETE CASCADE` de `note_tags` só leva os vínculos com notas já
 * apagadas. Cada tag vai para a auditoria como na exclusão de uma só.
 */

const MAX_TAGS_PER_PRUNE = 500;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pruneSchema = z.object({
  tagIds: z
    .array(z.string().regex(UUID))
    .min(1, "Nenhuma tag escolhida.")
    .max(MAX_TAGS_PER_PRUNE, `No máximo ${MAX_TAGS_PER_PRUNE} tags de uma vez.`),
});

export async function DELETE(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    // O mesmo balde da exclusão de uma tag: um lote é um gesto só.
    const limit = await rateLimit({
      key: `tags:delete:${user.id}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas exclusões seguidas. Aguarde um pouco.");
    }

    const parsed = pruneSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }

    const deleted = await deleteOrphanTags(
      user.id,
      Array.from(new Set(parsed.data.tagIds))
    );

    await Promise.all(
      deleted.map((tag) =>
        writeAuditLog({
          action: "DELETE",
          tableName: "tags",
          recordId: tag.id,
          userId: user.id,
          oldData: { name: tag.name, reason: "orphan-prune" },
          request,
        })
      )
    );

    if (deleted.length > 0) await invalidateNoteListCache(user.id);

    return NextResponse.json({ deletedIds: deleted.map((tag) => tag.id) });
  } catch (error) {
    const code = await logServerError(
      "DELETE /api/tags/orphans",
      error,
      { userId },
      request
    );
    return errorResponse(500, "Erro ao apagar as tags.", code);
  }
}
