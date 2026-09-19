import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import type { createClient } from "@/lib/supabase/server";

const BUCKET = "files";

/** O acervo aceita no máximo isto por pedido — o mesmo teto do lote de notas. */
export const MAX_ATTACHMENTS_PER_DELETE = 100;

/**
 * Apaga arquivos da pessoa: as linhas, os objetos no bucket e as janelas que
 * os mostravam.
 *
 * A nota que a Nexo escreveu sobre cada arquivo **fica** — é texto da conta,
 * não o arquivo. As janelas `kind = 'attachment'` somem pela FK composta com
 * `ON DELETE CASCADE` (0009).
 *
 * A posse entra na própria query (`user_id` do token): um id de outra conta
 * simplesmente não casa, e não aparece em `removed`. As linhas saem antes dos
 * objetos: se o Storage falhar, sobra objeto órfão no bucket privado, que
 * ninguém alcança — o contrário deixaria na tela um arquivo que não abre.
 */
export async function deleteOwnedAttachments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  ids: string[],
  request: Request
): Promise<{ id: string; filename: string }[]> {
  if (ids.length === 0) return [];

  const removed = await db
    .delete(attachments)
    .where(and(inArray(attachments.id, ids), eq(attachments.userId, userId)))
    .returning({
      id: attachments.id,
      filename: attachments.filename,
      storagePath: attachments.storagePath,
    });

  await Promise.all(
    removed.map((attachment) =>
      writeAuditLog({
        action: "DELETE",
        tableName: "attachments",
        recordId: attachment.id,
        userId,
        oldData: { filename: attachment.filename },
        request,
      })
    )
  );

  const paths = removed.map((attachment) => attachment.storagePath);
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .remove(paths.slice(index, index + 100));
    if (error) {
      // As linhas já saíram: para a pessoa, os arquivos foram apagados. O que
      // sobrou no bucket fica registrado para a limpeza manual.
      await logServerError(
        "deleteOwnedAttachments (storage)",
        error,
        { userId, pending: paths.length - index },
        request
      );
      break;
    }
  }

  return removed.map(({ id, filename }) => ({ id, filename }));
}
