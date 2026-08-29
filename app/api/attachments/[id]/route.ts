import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "files";

/**
 * Quanto tempo a URL vale.
 *
 * Curto de propósito: a URL assinada é um segredo portátil — quem a tiver
 * abre o arquivo sem sessão nenhuma. Quinze minutos cobrem a leitura de um PDF e
 * a reprodução de um áudio inteiro, e sobram pouco para o link vazar e ainda
 * servir. Quando expira, o visualizador pede outra.
 */
const EXPIRES_IN_SECONDS = 900;

const querySchema = z.object({
  /** Pede a URL com cabeçalho de download em vez de exibição. */
  download: z.enum(["0", "1"]).optional(),
});

/**
 * A URL de leitura de um anexo.
 *
 * O bucket é privado, então o arquivo não tem endereço público: quem quiser
 * lê-lo precisa de uma URL assinada, e é esta rota que a emite — depois de
 * confirmar que o anexo é de quem pediu.
 *
 * O `storage_path` nunca sai daqui. O cliente conhece o anexo pelo id; o
 * caminho dentro do bucket é detalhe de arrumação interna, e mandá-lo junto
 * só ampliaria a superfície sem ganho nenhum.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/attachments/[id]">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    // Cada abertura de janela pede uma URL, e o visualizador pede outra
    // quando a anterior expira. O teto é alto para uso normal e baixo para
    // um laço automatizado colhendo links.
    const limit = await rateLimit({
      key: `attachments:url:${user.id}`,
      limit: 300,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitos arquivos abertos seguidos. Aguarde um pouco.");
    }

    const { id } = await ctx.params;

    const parsed = querySchema.safeParse({
      download: new URL(request.url).searchParams.get("download") ?? undefined,
    });
    if (!parsed.success) return errorResponse(400, "Parâmetro inválido.");

    const [attachment] = await db
      .select({
        storagePath: attachments.storagePath,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        type: attachments.type,
        sizeBytes: attachments.sizeBytes,
      })
      .from(attachments)
      .where(and(eq(attachments.id, id), eq(attachments.userId, user.id)))
      .limit(1);

    // 404 e não 403: confirmar que o anexo existe já seria informação.
    if (!attachment) return errorResponse(404, "Arquivo não encontrado.");

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(
        attachment.storagePath,
        EXPIRES_IN_SECONDS,
        parsed.data.download === "1"
          ? { download: attachment.filename }
          : undefined
      );

    if (error || !data?.signedUrl) {
      logServerError("GET /api/attachments/[id] (storage)", error, {
        attachmentId: id,
      });
      return errorResponse(500, "Não foi possível abrir o arquivo.");
    }

    return NextResponse.json(
      {
        url: data.signedUrl,
        expiresIn: EXPIRES_IN_SECONDS,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        type: attachment.type,
        sizeBytes: attachment.sizeBytes,
      },
      // A resposta carrega uma URL assinada de vida curta: nenhum cache,
      // nem do navegador nem de proxy no caminho.
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    logServerError("GET /api/attachments/[id]", error);
    return errorResponse(500, "Não foi possível abrir o arquivo.");
  }
}
