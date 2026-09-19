import { after, NextResponse } from "next/server";
import { z } from "zod";

import { isNoteAiConfigured } from "@/lib/ai/classify-note";
import {
  countStaleSummaries,
  readNotes,
  requestSummaryRefresh,
} from "@/lib/ai/note-reading";
import {
  countUnfiledNotes,
  isOrganizing,
  organizeNotes,
} from "@/lib/ai/organize-notes";
import { errorResponse, logServerError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * O cartão "Reler e organizar" de Notas (`components/notes/ai-review-card.tsx`).
 *
 * `GET` conta o que há para fazer: resumos que ficaram de uma versão anterior
 * (a releitura foi só de tags — `docs/IA-LEITURA.md` §6.1) e notas sem pasta.
 * `POST` faz o que a pessoa marcou. Nada disso roda sozinho: é a pessoa quem
 * pede, e por isso a reescrita dos resumos passa por cima do teto diário por
 * nota — mas não do teto por hora, que é defesa, não economia.
 */

const reviewSchema = z
  .object({
    summaries: z.boolean().default(false),
    folders: z.boolean().default(false),
  })
  .refine((value) => value.summaries || value.folders, {
    message: "Escolha o que a Nexo deve fazer.",
  });

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET(request: Request) {
  let userId: string | null = null;
  try {
    const user = await currentUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `ai:review:read:${user.id}`,
      limit: 600,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) return errorResponse(429, "Muitas requisições. Aguarde um pouco.");

    const configured = isNoteAiConfigured();
    const [staleSummaries, unfiled, organizing] = configured
      ? await Promise.all([
          countStaleSummaries(user.id),
          countUnfiledNotes(user.id),
          isOrganizing(user.id),
        ])
      : [0, 0, false];

    return NextResponse.json(
      { configured, staleSummaries, unfiled, organizing },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    const code = await logServerError("GET /api/ai/review", error, { userId }, request);
    return errorResponse(500, "Erro ao consultar a IA.", code);
  }
}

export async function POST(request: Request) {
  let userId: string | null = null;
  try {
    const user = await currentUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    // Cada pedido é uma organização (uma chamada) e até 20 resumos: poucos
    // por hora bastam para quem usa, e seguram um cliente forjado.
    const limit = await rateLimit({
      key: `ai:review:run:${user.id}`,
      limit: 6,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "A Nexo já reorganizou várias vezes nesta hora. Tente mais tarde.");
    }

    if (!isNoteAiConfigured()) {
      return errorResponse(409, "Esta instância ainda não tem uma chave de IA configurada.");
    }

    const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }

    const ownerId = user.id;
    const refreshing = parsed.data.summaries ? await requestSummaryRefresh(ownerId) : [];
    const organizing = parsed.data.folders && !(await isOrganizing(ownerId));

    // Resumos primeiro: a organização lê os resumos, e assim lê os novos.
    after(async function runReview() {
      if (refreshing.length) await readNotes(ownerId, refreshing, { request });
      if (organizing) await organizeNotes(ownerId, { request });
    });

    return NextResponse.json({ summaries: refreshing.length, organizing }, { status: 202 });
  } catch (error) {
    const code = await logServerError("POST /api/ai/review", error, { userId }, request);
    return errorResponse(500, "Erro ao pedir a revisão.", code);
  }
}
