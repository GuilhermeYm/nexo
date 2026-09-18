import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { noteAiState, type NoteAiStateValue } from "@/lib/db/schema";

/**
 * O que a interface mostra sobre a leitura da IA numa nota.
 *
 * Existe porque `stale` precisa dos hashes, e os hashes não são legíveis pelo
 * cliente (GRANT por coluna em 0024). O servidor compara e entrega só o
 * veredito — o editor nunca vê `content_hash` nem `dirty_hash`.
 */
export interface NoteAiView {
  state: NoteAiStateValue;
  summary: string | null;
  /** O texto mudou depois do resumo: ele é de uma versão anterior. */
  stale: boolean;
  readAt: string | null;
  suggestedType: string | null;
}

export async function getNoteAiView(
  userId: string,
  noteId: string
): Promise<NoteAiView | null> {
  const [row] = await db
    .select({
      state: noteAiState.state,
      summary: noteAiState.summary,
      summaryHash: noteAiState.summaryHash,
      dirtyHash: noteAiState.dirtyHash,
      readAt: noteAiState.readAt,
      suggestedType: noteAiState.suggestedType,
    })
    .from(noteAiState)
    .where(and(eq(noteAiState.noteId, noteId), eq(noteAiState.userId, userId)))
    .limit(1);

  if (!row) return null;

  return {
    state: row.state,
    summary: row.summary,
    stale:
      row.summary !== null &&
      row.dirtyHash !== null &&
      row.summaryHash !== row.dirtyHash,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    suggestedType: row.suggestedType,
  };
}
