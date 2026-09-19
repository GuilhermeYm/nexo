import { randomUUID } from "node:crypto";

import { after, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import {
  aiJobs,
  attachments,
  noteTags,
  notes,
  tags,
} from "@/lib/db/schema";
import {
  classifyDocument,
  MAX_INPUT_CHARS,
  type ClassifyFailure,
} from "@/lib/ai/classify-document";
import { getAiPreferences } from "@/lib/ai/preferences";
import { hasAudioTranscriptionProvider } from "@/lib/ai/transcribe-audio";
import { processAudioTranscription } from "@/lib/ai/process-audio-transcription";
import {
  hasImageReadingProvider,
  imageReadingSetupHint,
  readImageSize,
} from "@/lib/ai/read-image";
import { processImageReading } from "@/lib/ai/process-image-reading";
import { redactAndTrim } from "@/lib/errors/redact";
import { reportError } from "@/lib/errors/report";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { errorResponse, logServerError } from "@/lib/api";
import { invalidateNoteListCache } from "@/lib/notes/cache";
import {
  ATTACHMENT_TYPES,
  type AttachmentListSort,
} from "@/lib/attachments/list";
import { listOwnedAttachments } from "@/lib/attachments/queries";
import {
  deleteOwnedAttachments,
  MAX_ATTACHMENTS_PER_DELETE,
} from "@/lib/attachments/delete";
import { matchesSignature, readSignature } from "@/lib/validations/file-signature";

const BUCKET = "files";
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — igual ao limite do bucket
const PDF_PARSE_TIMEOUT_MS = 15_000;

const listAttachmentsSchema = z.object({
  q: z.string().trim().max(120).default(""),
  type: z.enum(["all", ...ATTACHMENT_TYPES]).default("all"),
  sort: z.enum(["newest", "name", "size"]).default("newest"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

// O callback de `after()` da transcrição precisa de tempo depois do 201. Em
// VPS/Node o Next termina callbacks pendentes num shutdown gracioso; plataformas
// que entendem esta configuração podem estender o limite da rota para ele.
export const maxDuration = 75;

type AttachmentType = "pdf" | "document" | "audio" | "image";

// Whitelist de MIME — precisa bater com allowed_mime_types do bucket files
// (0003 e, para imagem, 0030). SVG e HEIC ficam de fora: ver 0030.
const MIME_TO_TYPE: Record<string, AttachmentType> = {
  "application/pdf": "pdf",
  "text/plain": "document",
  "text/markdown": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "document",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
};

/**
 * Acervo de metadados dos arquivos da conta.
 *
 * Diferente de `GET /api/attachments/[id]`, esta rota não emite URL assinada
 * nem revela `storage_path`. A URL é um segredo portátil e só é criada no
 * instante em que a pessoa abre ou baixa um arquivo específico.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `attachments:list:${user.id}`,
      limit: 180,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas consultas seguidas. Aguarde um instante.");
    }

    const params = new URL(request.url).searchParams;
    const parsed = listAttachmentsSchema.safeParse({
      q: params.get("q") ?? "",
      type: params.get("type") ?? "all",
      sort: params.get("sort") ?? "newest",
      page: params.get("page") ?? "1",
    });
    if (!parsed.success) return errorResponse(400, "Filtros inválidos.");

    return NextResponse.json(
      await listOwnedAttachments(user.id, {
        query: parsed.data.q,
        type: parsed.data.type,
        sort: parsed.data.sort as AttachmentListSort,
        page: parsed.data.page,
      }),
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    const code = await logServerError("GET /api/attachments", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar os arquivos.", code);
  }
}

const deleteAttachmentsSchema = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_ATTACHMENTS_PER_DELETE)
    .refine((ids) => new Set(ids).size === ids.length, "IDs repetidos."),
});

/**
 * Apaga vários arquivos de uma vez — a seleção em massa do acervo.
 *
 * Ids de outra conta ou já apagados não casam com a query e ficam fora de
 * `deleted`: a resposta diz quantos saíram de fato, e o cliente tira da tela
 * todos os que pediu (os que não existem também não deveriam estar lá).
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const parsed = deleteAttachmentsSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) return errorResponse(400, "Seleção inválida.");

    // Mesmo balde da exclusão individual: um lote não abre um teto à parte.
    const limit = await rateLimit({
      key: `attachments:delete:${user.id}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas exclusões seguidas. Aguarde um pouco.");
    }

    const removed = await deleteOwnedAttachments(supabase, user.id, parsed.data.ids, request);
    return NextResponse.json({ ok: true, deleted: removed.length });
  } catch (error) {
    const code = await logServerError("DELETE /api/attachments", error, { userId }, request);
    return errorResponse(500, "Não foi possível apagar os arquivos.", code);
  }
}

/**
 * O que muda entre os dois tipos que a IA lê depois da resposta. O fluxo é um
 * só; os textos e o worker são de cada um.
 */
const DEFERRED_READING = {
  audio: {
    ready: hasAudioTranscriptionProvider,
    setupHint: () =>
      "Configure GROQ_API_KEY ou OPENAI_API_KEY nesta instância e envie um novo áudio para transcrevê-lo.",
    fallbackTitle: "Áudio",
    metadataKey: "transcription",
    jobKind: "transcribe",
    pendingContent: "Áudio aguardando transcrição.",
    waitingContent:
      "Áudio aguardando a configuração de uma chave de IA para ser transcrito.",
    runningLabel: "Transcrevendo",
    waitingLabel: "Transcrição aguardando IA",
    pendingDetail:
      "O áudio está guardado; a transcrição e a classificação aparecem nesta nota quando terminarem.",
  },
  image: {
    ready: hasImageReadingProvider,
    setupHint: imageReadingSetupHint,
    fallbackTitle: "Imagem",
    metadataKey: "imageReading",
    // `extract` existe no enum desde 0004 com este fim: "PDF/imagem -> texto".
    jobKind: "extract",
    pendingContent: "Imagem aguardando leitura.",
    waitingContent:
      "Imagem guardada. A descrição aparece aqui quando esta instância tiver um modelo de IA que enxerga imagens.",
    runningLabel: "Lendo",
    waitingLabel: "Leitura aguardando IA",
    pendingDetail:
      "A imagem está guardada; a descrição e o texto que aparece nela chegam a esta nota quando a leitura terminar.",
  },
} as const;

/**
 * O anexo como o cliente pode vê-lo: sem `storage_path` (arrumação interna)
 * e sem `metadata`. Antes a rota devolvia a linha inteira.
 */
function publicAttachment(row: typeof attachments.$inferSelect) {
  return {
    id: row.id,
    noteId: row.noteId,
    type: row.type,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt,
  };
}

/** `text/plain;charset=utf-8` → `text/plain`: a whitelist compara o tipo, não os parâmetros. */
function normalizeMimeType(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

/** Nome seguro para o storage: minúsculas, sem acento/espaço, extensão preservada. */
function sanitizeFilename(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const base = name
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "arquivo"}${ext.toLowerCase()}`;
}

/** Erro de leitura do PDF (parse ou timeout) — vira 422, não 500. */
class PdfReadError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout de ${ms}ms`)), ms)
    ),
  ]);
}

/** Extrai texto onde dá (txt/md/pdf); demais tipos seguem sem texto. */
async function extractText(file: File, mimeType: string): Promise<string> {
  try {
    if (mimeType === "text/plain" || mimeType === "text/markdown") {
      return await file.text();
    }
    if (mimeType === "application/pdf") {
      const { extractText: extractPdfText } = await import("unpdf");
      const buffer = new Uint8Array(await file.arrayBuffer());
      const { text } = await withTimeout(
        extractPdfText(buffer, { mergePages: true }),
        PDF_PARSE_TIMEOUT_MS
      );
      return Array.isArray(text) ? text.join("\n") : text;
    }
  } catch (error) {
    logServerError("/api/attachments (extractText)", error);
    // PDF ilegível é erro do arquivo, não do servidor: propaga para virar 422.
    if (mimeType === "application/pdf") {
      throw new PdfReadError("Não foi possível ler o PDF.");
    }
  }
  return "";
}

export async function POST(request: Request) {
  let uploadedPath: string | null = null;
  const supabase = await createClient();
  // Declarado fora do `try`: o `catch` precisa dele para o relatório de erro
  // não nascer órfão, e `const user` dentro do `try` não é visível lá fora.
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return errorResponse(401, "Não autenticado.");
    }
    userId = user.id;

    // Classificação com IA custa dinheiro — limite por usuário.
    const limit = await rateLimit({
      key: `attachments:${user.id}`,
      limit: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(
        429,
        "Limite de uploads por hora atingido. Tente mais tarde."
      );
    }

    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
      return errorResponse(400, "Envie um arquivo no campo 'file'.");
    }

    // O tipo sem parâmetros. O runtime do Bun entrega `text/plain;charset=utf-8`
    // para o mesmo arquivo que o Node entrega como `text/plain` — comparado
    // cru, todo .txt e .md voltava 415 com a aplicação rodando no Bun.
    const mimeType = normalizeMimeType(file.type);
    const attachmentType = MIME_TO_TYPE[mimeType];
    if (!attachmentType) {
      return errorResponse(415, "Tipo de arquivo não suportado.");
    }
    if (file.size === 0) {
      return errorResponse(400, "Arquivo vazio.");
    }
    if (file.size > MAX_FILE_SIZE) {
      return errorResponse(413, "Arquivo maior que 25MB.");
    }

    // O MIME vem do cliente — confere se o conteúdo bate com o declarado.
    const signature = await readSignature(file);
    if (!matchesSignature(mimeType, signature)) {
      return errorResponse(
        400,
        "O conteúdo do arquivo não corresponde ao tipo declarado."
      );
    }

    // 1) Upload para o bucket privado, sempre na pasta do próprio usuário
    //    (a policy do storage garante: foldername(name))[1] = auth.uid()).
    uploadedPath = `${user.id}/${randomUUID()}-${sanitizeFilename(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uploadedPath, file, { contentType: mimeType, upsert: false });
    if (uploadError) {
      const code = await logServerError(
        "/api/attachments (storage)",
        uploadError,
        { userId: user.id },
        request
      );
      uploadedPath = null;
      return errorResponse(500, "Não foi possível salvar o arquivo.", code);
    }

    // Áudio e imagem não têm texto até a IA ouvir ou olhar. O arquivo e a
    // nota nascem agora; o trabalho da IA roda depois da resposta, para não
    // prender a barra de envio. Ver docs/IA.md e docs/IMAGENS.md.
    if (attachmentType === "audio" || attachmentType === "image") {
      const deferred = DEFERRED_READING[attachmentType];
      const providerReady = deferred.ready();
      const title =
        file.name.replace(/\.[^.]+$/, "").slice(0, 200) || deferred.fallbackTitle;
      // Largura e altura, para a janela da lousa nascer na proporção da
      // imagem. Vão em `attachments.metadata`, que o cliente não lê direto.
      const imageSize =
        attachmentType === "image" ? await readImageSize(file) : null;

      const [note] = await db
        .insert(notes)
        .values({
          userId: user.id,
          title,
          content: providerReady ? deferred.pendingContent : deferred.waitingContent,
          type: "document",
          source: "user",
          metadata: {
            filename: file.name,
            mimeType: mimeType,
            sizeBytes: file.size,
            [deferred.metadataKey]: providerReady ? "queued" : "waiting_configuration",
          },
        })
        .returning();

      const [attachment] = await db
        .insert(attachments)
        .values({
          userId: user.id,
          noteId: note.id,
          type: attachmentType,
          storagePath: uploadedPath,
          filename: file.name,
          mimeType: mimeType,
          sizeBytes: file.size,
          metadata: imageSize ? { width: imageSize.width, height: imageSize.height } : null,
        })
        .returning();

      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: user.id,
          noteId: note.id,
          kind: deferred.jobKind,
          status: providerReady ? "queued" : "waiting_configuration",
          label: providerReady
            ? `${deferred.runningLabel} ${file.name}`
            : `${deferred.waitingLabel}: ${file.name}`,
          detail: providerReady ? deferred.pendingDetail : deferred.setupHint(),
        })
        .returning({ id: aiJobs.id });

      await writeAuditLog({
        action: "CREATE",
        tableName: "attachments",
        recordId: attachment.id,
        userId: user.id,
        newData: {
          filename: file.name,
          mimeType: mimeType,
          sizeBytes: file.size,
        },
        request,
      });
      await invalidateNoteListCache(user.id);

      if (providerReady) {
        const work = {
          file,
          filename: file.name,
          mimeType: mimeType,
          userId: user.id,
          noteId: note.id,
          jobId: job.id,
          request,
        };
        after(async function runDeferredReading() {
          if (attachmentType === "audio") await processAudioTranscription(work);
          else await processImageReading(work);
        });
      }

      return NextResponse.json(
        { note, attachment: publicAttachment(attachment), tags: [], aiClassified: false },
        { status: 201 }
      );
    }

    // 2) Extrai texto e classifica (Groq ou OpenAI se houver chave; stub
    //    caso contrário — ver lib/ai/classify-document.ts).
    const [text, { reasoningEffort }] = await Promise.all([
      extractText(file, mimeType),
      getAiPreferences(user.id),
    ]);
    const classifyStartedAt = new Date();
    const {
      result: classification,
      usedAi,
      failure: classifyFailure,
      provider: classifyProvider,
      model: classifyModel,
    } = await classifyDocument(
      { text, filename: file.name, mimeType: mimeType },
      { reasoningEffort }
    );
    const classifyFinishedAt = new Date();

    // A classificação falhou, o upload seguiu — e agora o motivo sobrevive.
    //
    // Nada disto muda a resposta: o arquivo está guardado e a nota existe. O
    // que muda é que a linha do feed passa a carregar um código, e o código
    // leva a uma linha de `error_reports` com o corpo do erro do provedor.
    // Era exatamente o que faltava no caso que motivou tudo isto.
    //
    // O nome do arquivo **não** entra no contexto (`sanitizeContext` o
    // descarta pelo nome da chave): nome de arquivo é conteúdo da pessoa, e o
    // feed de Tarefas já o mostra para quem tem direito de vê-lo.
    // `reportError` direto, e não `logServerError`: esta falha é `ai_job` e
    // não `api` — a rota respondeu 201, o produto não quebrou, e a triagem
    // precisa distinguir "o provedor de IA recusou" de "a rota explodiu". O
    // `console.error` fica escrito à mão para o operador continuar tendo a
    // mesma linha de sempre no stdout.
    let classifyErrorCode: string | null = null;
    if (classifyFailure) {
      console.error(
        `[AI] Classificação com ${classifyFailure.provider} falhou; usando stub.`,
        {
          model: classifyFailure.model,
          error: classifyFailure.message,
          timestamp: new Date().toISOString(),
        }
      );
      classifyErrorCode = await reportError({
        route: "/api/attachments (classify)",
        kind: "ai_job",
        message: classifyFailure.message,
        userId: user.id,
        context: {
          provider: classifyFailure.provider,
          model: classifyFailure.model,
          mimeType: mimeType,
          sizeBytes: file.size,
          hadText: text.length > 0,
        },
        request,
      });
    }

    // 3) Cria a nota com o resultado da classificação.
    const [note] = await db
      .insert(notes)
      .values({
        userId: user.id,
        title: classification.title,
        content: classification.summary,
        type: classification.noteType,
        source: usedAi ? "ai" : "user",
        metadata: {
          filename: file.name,
          mimeType: mimeType,
          sizeBytes: file.size,
          aiClassified: usedAi,
        },
      })
      .returning();

    // 3.1) Registra o trabalho no feed de Tarefas.
    //
    // Sem isto o painel "Tarefas" do dashboard fica permanentemente vazio,
    // enquanto o estado vazio dele promete que "cada coisa que a Nexo ler,
    // classificar ou marcar aparece aqui". A linha é o que torna o trabalho
    // do agente visível — e é ela que dá ao usuário como saber que a
    // classificação foi feita pelo modelo ou pelo fallback determinístico.
    await recordClassifyJob({
      userId: user.id,
      noteId: note.id,
      filename: file.name,
      classification,
      usedAi,
      failure: classifyFailure,
      errorCode: classifyErrorCode,
      startedAt: classifyStartedAt,
      finishedAt: classifyFinishedAt,
      provider: classifyProvider,
      model: classifyModel,
      inputChars: text.length,
    });

    // 4) Upsert das tags do usuário e vínculo com a nota.
    const tagNames = [...new Set(classification.tags.map((t) => t.toLowerCase()))];
    const existingTags = await db
      .select()
      .from(tags)
      .where(and(eq(tags.userId, user.id), inArray(tags.name, tagNames)));

    const existingNames = new Set(existingTags.map((t) => t.name));
    const missingNames = tagNames.filter((name) => !existingNames.has(name));
    const newTags = missingNames.length
      ? await db
          .insert(tags)
          .values(missingNames.map((name) => ({ userId: user.id, name })))
          .returning()
      : [];

    const allTags = [...existingTags, ...newTags];
    if (allTags.length) {
      await db
        .insert(noteTags)
        // Procedência `ai`: foi a classificação que escolheu, não a pessoa.
        .values(
          allTags.map((tag) => ({ noteId: note.id, tagId: tag.id, source: "ai" as const }))
        );
    }

    // 5) Registra o anexo já vinculado à nota.
    const [attachment] = await db
      .insert(attachments)
      .values({
        userId: user.id,
        noteId: note.id,
        type: attachmentType,
        storagePath: uploadedPath,
        filename: file.name,
        mimeType: mimeType,
        sizeBytes: file.size,
      })
      .returning();

    await writeAuditLog({
      action: "CREATE",
      tableName: "attachments",
      recordId: attachment.id,
      userId: user.id,
      // Só metadados — nunca o conteúdo do arquivo.
      newData: {
        filename: file.name,
        mimeType: mimeType,
        sizeBytes: file.size,
      },
      request,
    });

    await invalidateNoteListCache(user.id);

    return NextResponse.json(
      { note, attachment: publicAttachment(attachment), tags: allTags, aiClassified: usedAi },
      { status: 201 }
    );
  } catch (error) {
    // Se algo falhou depois do upload, remove o arquivo órfão do bucket.
    if (uploadedPath) {
      await supabase.storage
        .from(BUCKET)
        .remove([uploadedPath])
        .catch(() => undefined);
    }
    // PDF ilegível/corrompido é erro do arquivo enviado, não do servidor.
    if (error instanceof PdfReadError) {
      return errorResponse(422, "Não foi possível ler o PDF.");
    }
    const code = await logServerError("/api/attachments", error, { userId }, request);
    return errorResponse(500, "Erro interno. Tente novamente.", code);
  }
}

/**
 * Escreve a linha do feed de Tarefas.
 *
 * Falha de registro **nunca** derruba o upload: o arquivo já está guardado e
 * a nota já existe. Mesmo contrato do `writeAuditLog` — o try/catch só loga.
 *
 * Quando o modelo não respondeu, o estado é `failed` e não `succeeded`: o
 * fluxo terminou, mas o trabalho que o feed anuncia — ler e classificar — não
 * aconteceu, e dizer que aconteceu seria a interface mentindo sobre a própria
 * IA. O detalhe explica o que fazer com isso.
 */
async function recordClassifyJob(options: {
  userId: string;
  noteId: string;
  filename: string;
  classification: { noteType: string; tags: string[]; summary: string };
  usedAi: boolean;
  /** O que o provedor respondeu quando não classificou. */
  failure: ClassifyFailure | null;
  /** O código do relatório dessa falha, para a pessoa poder citá-lo. */
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date;
  provider: string | null;
  model: string | null;
  /** Tamanho do texto extraído — o que a IA teve para ler. */
  inputChars: number;
}): Promise<void> {
  const { classification, usedAi } = options;
  const typeLabel = NOTE_TYPE_LABEL[classification.noteType] ?? "Nota";
  const tagCount = classification.tags.length;

  try {
    await db.insert(aiJobs).values({
      userId: options.userId,
      noteId: options.noteId,
      kind: "classify",
      status: usedAi ? "succeeded" : "failed",
      label: usedAi
        ? `Classificou ${options.filename}`
        : `Não conseguiu classificar ${options.filename}`,
      detail: usedAi
        ? `${typeLabel} · ${tagCount} tag${tagCount === 1 ? "" : "s"} · resumo de ${classification.summary.length} caracteres`
        : options.errorCode
          ? `O arquivo está guardado e a nota foi criada com o nome dele. Ajuste o tipo e as tags quando quiser — e informe o código ${options.errorCode} se quiser que a gente veja o que houve.`
          : "O arquivo está guardado e a nota foi criada com o nome dele. Ajuste o tipo e as tags quando quiser.",
      // A coluna existia desde 0004 e o caminho da classificação **nunca** a
      // preenchia: a linha registrava que falhou e jogava fora o porquê.
      //
      // Censurada, e isso não é excesso de zelo: desde 0005 `ai_jobs` é
      // SELECT-only **para o dono**, ou seja, ele lê esta coluna pelo
      // PostgREST. O corpo de erro de um provedor às vezes ecoa o começo da
      // chave enviada, e sem `redactAndTrim` a chave da instalação sairia
      // pela porta da frente. É a mesma função que protege `error_reports`,
      // aqui pelo motivo oposto: lá porque a coluna nunca é lida pelo
      // cliente, aqui porque esta sempre é.
      error: options.failure
        ? redactAndTrim(
            `${options.failure.provider} (${options.failure.model}): ${options.failure.message}`,
            1000
          )
        : null,
      errorCode: options.errorCode,
      // O que a tela cheia de Tarefas mostra no detalhe. Só metadados: o
      // resumo e o texto do arquivo nunca entram aqui — `result` é legível
      // pelo dono via PostgREST, e o conteúdo mora na nota.
      result: usedAi
        ? {
            tags: classification.tags,
            typeSuggested: classification.noteType,
            summarized: true,
            summaryChars: classification.summary.length,
            inputChars: Math.min(options.inputChars, MAX_INPUT_CHARS),
            noteChars: options.inputChars,
            truncated: options.inputChars > MAX_INPUT_CHARS,
            durationMs:
              options.finishedAt.getTime() - options.startedAt.getTime(),
            provider: options.provider,
            model: options.model,
          }
        : null,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
    });
  } catch (error) {
    void logServerError("recordClassifyJob", error, { noteId: options.noteId });
  }
}

/** Rótulos dos tipos, para a linha do feed sair em português. */
const NOTE_TYPE_LABEL: Record<string, string> = {
  note: "Nota",
  task: "Tarefa",
  journal: "Diário",
  idea: "Ideia",
  meeting: "Reunião",
  document: "Documento",
};
