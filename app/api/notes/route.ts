import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { notes, workspaces } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Cria uma nota fora de qualquer lousa.
 *
 * Existe por causa do rascunho do dashboard, que vive no navegador e só vem
 * para cá quando a pessoa manda. Diferente de
 * `POST /api/workspaces/[id]/windows`, aqui não nasce janela nenhuma: a nota
 * entra na conta e pronto. Quem quiser vê-la numa lousa a traz depois, pelo
 * "Trazer da conta".
 */

const createNoteSchema = z
  .object({
    title: z.string().trim().max(200).default(""),
    content: z.string().max(20_000).default(""),
  })
  // Nota sem título e sem texto não é nota; é um clique errado. Recusar aqui
  // evita uma linha vazia permanente na conta de quem só encostou no botão.
  .refine(
    (value) => value.title.length > 0 || value.content.trim().length > 0,
    { message: "Escreva um título ou um texto." }
  );

export async function POST(request: Request) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `notes:create:${user.id}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas notas criadas. Aguarde um pouco.");
    }

    const parsed = createNoteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }
    const input = parsed.data;

    // A nota ganha um lugar: o workspace padrão, ou o mais antigo se o
    // padrão tiver sido excluído. Uma nota com `workspace_id` nulo continua
    // achável pela busca, mas não aparece em lousa nenhuma — e é assim que
    // conteúdo some de vista sem ter sido apagado.
    const [home] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.userId, user.id))
      .orderBy(desc(workspaces.isDefault), workspaces.createdAt)
      .limit(1);

    const [created] = await db
      .insert(notes)
      .values({
        // Do token, nunca do corpo.
        userId: user.id,
        workspaceId: home?.id ?? null,
        title: input.title || firstLine(input.content) || "Sem título",
        content: input.content,
        type: "note",
        source: "user",
      })
      .returning({ id: notes.id, title: notes.title });

    return NextResponse.json({ note: created }, { status: 201 });
  } catch (error) {
    logServerError("POST /api/notes", error);
    return errorResponse(500, "Erro ao guardar a nota.");
  }
}

/** Título de emergência: a primeira linha do texto, cortada. */
function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
