import { after, NextResponse } from "next/server";
import { z } from "zod";

import { readNote } from "@/lib/ai/note-reading";
import { errorResponse, logServerError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const noteIdSchema = z.string().uuid();

/**
 * "A pessoa parou de escrever" — o gatilho A da leitura por IA.
 *
 * O editor chama isto depois de um tempo quieto, ou ao sair da nota quando
 * não havia nada na fila para salvar (havendo, o aviso vai no próprio PATCH,
 * com `?analyze=1`). Responde 202 na hora; a leitura acontece em `after()`.
 *
 * A rota não decide **se** a nota merece leitura: isso já foi decidido quando
 * ela foi salva (`markNoteForReading`), e a tranca de `note_ai_state` faz um
 * chamado sem nada pendente custar um UPDATE que não casa com linha nenhuma.
 * Por isso chamar de mais é barato — e o teto por hora de `readNote` é o que
 * segura o custo diante de um cliente forjado.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/notes/[id]/analyze">
) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const { id } = await ctx.params;
    const parsedId = noteIdSchema.safeParse(id);
    if (!parsedId.success) return errorResponse(400, "Nota inválida.");

    const limit = await rateLimit({
      key: `notes:analyze:${user.id}`,
      limit: 240,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitos pedidos seguidos. Aguarde um pouco.");
    }

    // O `readNote` cruza `note_id` com o dono na tranca: uma nota de outra
    // conta não casa com linha nenhuma e nada acontece — sem vazar se ela
    // existe, porque a resposta é a mesma.
    const ownerId = user.id;
    const noteId = parsedId.data;
    after(async function readNoteOnRequest() {
      await readNote(ownerId, noteId, { request });
    });

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    const code = await logServerError(
      "POST /api/notes/[id]/analyze",
      error,
      { userId },
      request
    );
    return errorResponse(500, "Erro ao pedir a leitura.", code);
  }
}
