import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { ERROR_CODE_PATTERN } from "@/lib/errors/code";
import { attachUserReport } from "@/lib/errors/queries";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * "O que você estava fazendo?" — o relato da pessoa sobre um erro que o
 * servidor já registrou.
 *
 * É o outro lado de `POST /api/errors`: lá o cliente traz o erro **e** o
 * relato porque não existe linha ainda; aqui a linha existe (a rota que
 * falhou já a criou e devolveu o código junto com o 500), e o que falta é a
 * metade que só a pessoa sabe. É essa metade que faz o suporte responder em
 * vez de perguntar.
 *
 * ## Três travas, e nenhuma delas é o código ser difícil de adivinhar
 *
 * - **O dono vem do token.** O `code` da URL é entrada do cliente como
 *   qualquer outra, e o `UPDATE` filtra por `auth.uid()`. Acertar um código
 *   de outra conta alcança zero linhas.
 * - **A resposta é a mesma para código inexistente e código dos outros.** Um
 *   404 diferente de um 403 transformaria esta rota num oráculo de "este
 *   código existe" — e o código aparece em tela, em e-mail e em print.
 * - **Só duas colunas mudam.** `user_report` e `user_reported_at`, em
 *   `attachUserReport`. Se daqui saísse um `set` genérico, o mesmo caminho
 *   que existe para contar o que aconteceu serviria para reescrever o que o
 *   servidor registrou.
 */

const bodySchema = z.object({
  report: z.string().trim().min(1).max(2000),
});

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `errors:report:${user.id}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitos relatos seguidos. Aguarde um pouco.");
    }

    const { code } = await ctx.params;
    // Um texto qualquer no lugar do código não é erro de servidor, é endereço
    // que não existe — mesmo critério do uuid em `/api/notifications/[id]`.
    if (!ERROR_CODE_PATTERN.test(code)) {
      return errorResponse(404, "Código não encontrado.");
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, "Escreva o que aconteceu.");
    }

    const ok = await attachUserReport(user.id, code, parsed.data.report);
    if (!ok) return errorResponse(404, "Código não encontrado.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    const failureCode = await logServerError(
      "PATCH /api/errors/[code]",
      error,
      {},
      request
    );
    return errorResponse(500, "Não foi possível enviar o relato.", failureCode);
  }
}
