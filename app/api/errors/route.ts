import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, getClientIp, logServerError } from "@/lib/api";
import { listOwnErrorReports } from "@/lib/errors/queries";
import { reportError } from "@/lib/errors/report";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * `POST` — o erro que quebrou no navegador, reportado pela pessoa.
 * `GET` — a lista "Meus erros" das configurações.
 *
 * ## Esta é a única superfície de escrita quase-anônima do produto
 *
 * Todo o resto exige sessão. Aqui não dá: metade dos erros que valem reportar
 * acontece na tela de login, ou depois que a sessão expirou no meio de uma
 * navegação — exatamente os casos em que a pessoa mais precisa de um código
 * para citar. Aceitar `user_id` nulo é a razão de esta rota existir.
 *
 * O preço disso é tratar cada campo como hostil, e é o que está abaixo:
 * limite por IP **e** por usuário, teto de tamanho em tudo, `kind` fixo em
 * `client`/`unhandled` (ninguém forja um erro `api` daqui) e o texto passando
 * pela censura de `lib/errors/redact.ts` antes de tocar no banco.
 *
 * ## E é sempre a pessoa que aperta o botão
 *
 * Nada nesta rota é chamado sozinho. O error boundary mostra o que quebrou e
 * um botão; sem o clique, nada sai do navegador. A alternativa — reportar
 * todo erro de cliente automaticamente — daria cobertura melhor e coletaria
 * o que ninguém ofereceu: um stack de cliente carrega o caminho que a pessoa
 * estava percorrendo, e a intenção declarada desta funcionalidade é **deixar
 * a pessoa mandar** o erro, não recolhê-lo dela.
 */

const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;
const MAX_ROUTE = 200;
const MAX_REPORT = 2000;

const reportSchema = z.object({
  /** A mensagem do erro como o React a entregou ao boundary. */
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  /** Onde a pessoa estava. Do cliente, então é dado, não verdade. */
  route: z.string().trim().min(1).max(MAX_ROUTE),
  /** `componentStack` do React, ou o stack do erro. */
  stack: z.string().max(MAX_STACK).optional(),
  /**
   * O `digest` que o Next gera para erro de Server Component. Ele é a ponte
   * para o log do servidor — o mesmo hash aparece dos dois lados.
   */
  digest: z.string().max(100).optional(),
  /** O que a pessoa escreveu. Opcional: às vezes ela só quer o código. */
  report: z.string().trim().max(MAX_REPORT).optional(),
  kind: z.enum(["client", "unhandled"]).default("client"),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  // Pode ficar nulo — a sessão é lida, não exigida (ver o porquê acima) — mas
  // precisa existir fora do `try` para o `catch` alcançar o que foi lido.
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;

    // Dois limites, e os dois são necessários. Por IP porque sem sessão é o
    // único identificador que existe; por usuário porque um cliente logado e
    // adulterado atravessa NATs e proxies, onde o IP para de separar as
    // pessoas.
    const perIp = await rateLimit({
      key: `errors:ip:${getClientIp(request)}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (!perIp.success) {
      return errorResponse(429, "Muitos relatos seguidos. Aguarde um pouco.");
    }

    if (user) {
      const perUser = await rateLimit({
        key: `errors:user:${user.id}`,
        limit: 30,
        windowMs: 60 * 60 * 1000,
      });
      if (!perUser.success) {
        return errorResponse(429, "Muitos relatos seguidos. Aguarde um pouco.");
      }
    }

    const parsed = reportSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, "Relato inválido.");
    }

    const code = await reportError({
      route: parsed.data.route,
      kind: parsed.data.kind,
      message: parsed.data.message,
      stack: parsed.data.stack ?? null,
      // `digest` é o único campo do corpo que vai para `context`, e ele é um
      // hash. O resto do que o cliente mandou já tem coluna própria.
      context: parsed.data.digest ? { digest: parsed.data.digest } : null,
      userReport: parsed.data.report ?? null,
      // Do token. Um `user_id` no corpo seria a forma mais barata de encher a
      // aba "Meus erros" de outra pessoa.
      userId: user?.id ?? null,
      request,
    });

    return NextResponse.json({ code }, { status: 201 });
  } catch (error) {
    // A rota que registra erro também pode falhar, e aí ela é só mais uma.
    const code = await logServerError("POST /api/errors", error, { userId }, request);
    return errorResponse(500, "Não foi possível registrar o relato.", code);
  }
}

/** A lista da aba "Meus erros". Só do dono, e só as colunas seguras. */
export async function GET(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const reports = await listOwnErrorReports(user.id);
    return NextResponse.json({ reports });
  } catch (error) {
    const code = await logServerError("GET /api/errors", error, { userId }, request);
    return errorResponse(500, "Não foi possível ler os relatos.", code);
  }
}
