import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import {
  aiJobs,
  attachments,
  noteTags,
  notes,
  tags,
} from "@/lib/db/schema";
import { classifyDocument } from "@/lib/ai/classify-document";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { errorResponse, logServerError, planLimitResponse } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { getUploadQuotaContext } from "@/lib/usage/queries";
import { matchesSignature, readSignature } from "@/lib/validations/file-signature";

const BUCKET = "files";
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — igual ao limite do bucket
const PDF_PARSE_TIMEOUT_MS = 15_000;

type AttachmentType = "pdf" | "document" | "audio";

// Whitelist de MIME — precisa bater com allowed_mime_types do bucket files.
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
};

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
async function extractText(file: File): Promise<string> {
  try {
    if (file.type === "text/plain" || file.type === "text/markdown") {
      return await file.text();
    }
    if (file.type === "application/pdf") {
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
    if (file.type === "application/pdf") {
      throw new PdfReadError("Não foi possível ler o PDF.");
    }
  }
  return "";
}

export async function POST(request: Request) {
  let uploadedPath: string | null = null;
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return errorResponse(401, "Não autenticado.");
    }

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

    const attachmentType = MIME_TO_TYPE[file.type];
    if (!attachmentType) {
      return errorResponse(415, "Tipo de arquivo não suportado.");
    }
    if (file.size === 0) {
      return errorResponse(400, "Arquivo vazio.");
    }
    if (file.size > MAX_FILE_SIZE) {
      return errorResponse(413, "Arquivo maior que 25MB.");
    }

    // Tetos do plano, antes de gastar upload e classificação num arquivo que
    // não vai poder ficar. Os dois são promessa da página de planos: "50
    // capturas por mês" e "200 MB de arquivos" no Gratuito.
    //
    // `planLimitResponse` e não `errorResponse`: bater no teto não é defeito,
    // e a interface precisa saber disso para oferecer o Pro em vez de mandar
    // a pessoa tentar de novo.
    const quota = await getUploadQuotaContext(user.id, file.size);

    if (quota.captures && !quota.captures.ok) {
      return planLimitResponse(
        409,
        `Você já fez as ${quota.captures.limit} capturas deste mês do plano Gratuito. No Pro elas são ilimitadas.`
      );
    }

    if (quota.storage && !quota.storage.ok) {
      return planLimitResponse(
        413,
        `Os ${formatBytes(quota.storage.limit)} de arquivos do plano Gratuito estão cheios. O Pro tem 20 GB.`
      );
    }

    // O MIME vem do cliente — confere se o conteúdo bate com o declarado.
    const signature = await readSignature(file);
    if (!matchesSignature(file.type, signature)) {
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
      .upload(uploadedPath, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      logServerError("/api/attachments (storage)", uploadError, {
        userId: user.id,
      });
      uploadedPath = null;
      return errorResponse(500, "Não foi possível salvar o arquivo.");
    }

    // 2) Extrai texto e classifica (Groq ou OpenAI se houver chave; stub
    //    caso contrário — ver lib/ai/classify-document.ts).
    const text = await extractText(file);
    const classifyStartedAt = new Date();
    const { result: classification, usedAi } = await classifyDocument({
      text,
      filename: file.name,
      mimeType: file.type,
    });
    const classifyFinishedAt = new Date();

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
          mimeType: file.type,
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
      startedAt: classifyStartedAt,
      finishedAt: classifyFinishedAt,
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
        .values(allTags.map((tag) => ({ noteId: note.id, tagId: tag.id })));
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
        mimeType: file.type,
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
        mimeType: file.type,
        sizeBytes: file.size,
      },
      request,
    });

    return NextResponse.json(
      { note, attachment, tags: allTags, aiClassified: usedAi },
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
    logServerError("/api/attachments", error);
    return errorResponse(500, "Erro interno. Tente novamente.");
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
  startedAt: Date;
  finishedAt: Date;
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
        : "O arquivo está guardado e a nota foi criada com o nome dele. Ajuste o tipo e as tags quando quiser.",
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
    });
  } catch (error) {
    logServerError("recordClassifyJob", error, { noteId: options.noteId });
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
