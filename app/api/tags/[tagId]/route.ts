import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { tags } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { TAG_PALETTE } from "@/lib/tags/palette";

/**
 * Renomear uma tag e escolher a cor dela.
 *
 * A tag é da conta, não da nota: mudar o nome aqui muda em todas as notas
 * marcadas, e é por isso que a rota mora em `/api/tags/[tagId]` e não pendura
 * no id de uma nota. Quem chama é a janela da lousa — o gesto de corrigir a
 * etiqueta acontece enquanto se escreve, não numa tela de administração à
 * parte.
 *
 * **A cor é uma posição na paleta, não uma cor.** A coluna guarda `"1"`..`"6"`
 * e os tokens do tema (`--color-tag-N`) decidem o que isso é em cada tema. Se
 * ela guardasse `#e8f0d4`, um dia o tema escuro chegaria e a tag ficaria com
 * a cor do tema claro presa dentro do banco.
 *
 * **A troca de nome é auditada; a de cor não.** Mesmo critério do título da
 * nota e do nome do workspace: o nome é como a pessoa reencontra o que
 * guardou, e um renomeio que ninguém lembra de ter feito é indistinguível de
 * um sumiço. A cor é aparência, e trocá-la não esconde nada de ninguém.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchTagSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Escreva o nome da tag.")
      .max(40, "No máximo 40 caracteres.")
      // A mesma normalização da criação e da classificação por IA — senão
      // "Projeto X" e "projeto  x" viram duas tags e o índice único não
      // impede nada.
      .transform((value) => value.toLowerCase().replace(/\s+/g, " "))
      .optional(),
    // `null` limpa a cor: a tag volta a ser cinza onde a cor gravada manda, e
    // volta a derivar do nome na página de tags.
    color: z
      .union([z.enum(TAG_PALETTE), z.null()])
      .optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.color !== undefined,
    { message: "Nada para mudar." }
  );

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/tags/[tagId]">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `tags:patch:${user.id}`,
      limit: 240,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas edições seguidas. Aguarde um pouco.");
    }

    const { tagId } = await ctx.params;
    if (!UUID.test(tagId)) return errorResponse(404, "Tag não encontrada.");

    const parsed = patchTagSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }

    // Lido antes porque a auditoria precisa do nome anterior — e porque um
    // 404 explicado vale mais que um `update` que não casa com nada.
    const [current] = await db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(tags)
      .where(and(eq(tags.id, tagId), eq(tags.userId, user.id)))
      .limit(1);

    if (!current) return errorResponse(404, "Tag não encontrada.");

    const [updated] = await db
      .update(tags)
      .set({
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.color !== undefined && { color: parsed.data.color }),
      })
      // O `userId` no `where` de novo: a leitura acima já conferiu, mas uma
      // escrita que depende de uma leitura anterior para estar segura fica
      // insegura no dia em que alguém mexer na leitura.
      .where(and(eq(tags.id, tagId), eq(tags.userId, user.id)))
      .returning({ id: tags.id, name: tags.name, color: tags.color });

    if (parsed.data.name !== undefined && parsed.data.name !== current.name) {
      await writeAuditLog({
        request,
        userId: user.id,
        action: "UPDATE",
        tableName: "tags",
        recordId: tagId,
        oldData: { name: current.name },
        newData: { name: updated.name },
      });
    }

    return NextResponse.json({ tag: updated });
  } catch (error) {
    // Índice único (user_id, name): já existe uma tag com esse nome.
    if (isUniqueViolation(error)) {
      return errorResponse(409, "Você já tem uma tag com esse nome.");
    }

    const code = await logServerError("PATCH /api/tags/[tagId]", error);
    return errorResponse(500, "Erro ao salvar a tag.", code);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
