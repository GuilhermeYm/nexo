import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getAiPreferences } from "@/lib/ai/preferences";
import { readImage } from "@/lib/ai/read-image";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { aiJobs, noteTags, notes, tags } from "@/lib/db/schema";
import { redactAndTrim } from "@/lib/errors/redact";
import { reportError } from "@/lib/errors/report";
import { invalidateNoteListCache } from "@/lib/notes/cache";

interface ProcessImageReadingInput {
  file: File;
  filename: string;
  mimeType: string;
  userId: string;
  noteId: string;
  jobId: string;
  request: Request;
}

/** O título do bloco com o texto que a IA leu na imagem, dentro da nota. */
export const IMAGE_TEXT_HEADING = "Texto na imagem";

/**
 * Worker disparado depois da resposta do upload de uma imagem — o mesmo
 * contrato de `processAudioTranscription`: a nota e o arquivo já existem
 * antes dele começar, e nada do que acontece aqui os faz sumir.
 *
 * O resultado mora na nota: a descrição no topo e, quando há, o texto lido
 * da imagem abaixo de "Texto na imagem". É isso que faz uma foto de recibo
 * ser achada pela busca por uma palavra que só existe dentro dela.
 */
export async function processImageReading(
  input: ProcessImageReadingInput
): Promise<void> {
  const startedAt = new Date();

  try {
    await db
      .update(aiJobs)
      .set({ status: "running", startedAt })
      .where(and(eq(aiJobs.id, input.jobId), eq(aiJobs.userId, input.userId)));

    const { reasoningEffort } = await getAiPreferences(input.userId);
    const { reading, provider, model, usage, sentBytes } = await readImage(
      input.file,
      input.mimeType,
      { filename: input.filename, reasoningEffort }
    );

    const content = reading.text
      ? [reading.description, "", IMAGE_TEXT_HEADING, reading.text].join("\n")
      : reading.description;

    await db
      .update(notes)
      .set({
        title: reading.title,
        content,
        type: reading.noteType,
        source: "ai",
      })
      .where(and(eq(notes.id, input.noteId), eq(notes.userId, input.userId)));

    // Só acrescenta tags, como a transcrição: apagar as existentes poderia
    // levar uma que a pessoa pôs enquanto a leitura ainda rodava.
    const tagNames = [...new Set(reading.tags.map((tag) => tag.toLowerCase()))];
    const existing = tagNames.length
      ? await db
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(and(eq(tags.userId, input.userId), inArray(tags.name, tagNames)))
      : [];
    const existingNames = new Set(existing.map((tag) => tag.name));
    const missing = tagNames.filter((name) => !existingNames.has(name));
    const created = missing.length
      ? await db
          .insert(tags)
          .values(missing.map((name) => ({ userId: input.userId, name })))
          .onConflictDoNothing()
          .returning({ id: tags.id })
      : [];
    const tagIds = [...existing.map((tag) => tag.id), ...created.map((tag) => tag.id)];
    if (tagIds.length) {
      await db
        .insert(noteTags)
        .values(tagIds.map((tagId) => ({ noteId: input.noteId, tagId, source: "ai" as const })))
        .onConflictDoNothing();
    }

    const finishedAt = new Date();
    await db
      .update(aiJobs)
      .set({
        status: "succeeded",
        label: `Leu ${input.filename}`,
        detail: reading.text
          ? "A nota ganhou a descrição da imagem e o texto que aparece nela."
          : "A nota ganhou a descrição da imagem, o tipo e as tags.",
        // Metadados, nunca o texto: `result` é legível pelo dono via
        // PostgREST, e o conteúdo mora na nota.
        result: {
          provider,
          model,
          tags: reading.tags,
          typeSuggested: reading.noteType,
          summarized: true,
          summaryChars: reading.description.length,
          imageTextChars: reading.text.length,
          sentBytes,
          originalBytes: input.file.size,
          ...(usage && {
            promptTokens: usage.prompt,
            completionTokens: usage.completion,
          }),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        },
        finishedAt,
      })
      .where(and(eq(aiJobs.id, input.jobId), eq(aiJobs.userId, input.userId)));

    await writeAuditLog({
      action: "UPDATE",
      tableName: "notes",
      recordId: input.noteId,
      userId: input.userId,
      // O que a imagem diz nunca vai para a auditoria.
      oldData: { imageReading: "pending" },
      newData: { imageReading: "completed", imageTextChars: reading.text.length },
      request: input.request,
    });
    await invalidateNoteListCache(input.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    const code = await reportError({
      route: "image reading worker",
      kind: "ai_job",
      error,
      userId: input.userId,
      context: { mimeType: input.mimeType, sizeBytes: input.file.size },
      request: input.request,
    });

    await db
      .update(aiJobs)
      .set({
        status: "failed",
        label: `Não conseguiu ler ${input.filename}`,
        detail: `A imagem continua guardada. Informe o código ${code} se quiser ajuda para investigar.`,
        error: redactAndTrim(message, 1000),
        errorCode: code,
        finishedAt: new Date(),
      })
      .where(and(eq(aiJobs.id, input.jobId), eq(aiJobs.userId, input.userId)))
      .catch((updateError) => {
        console.error("[AI] Não foi possível registrar falha de leitura de imagem", {
          jobId: input.jobId,
          error: updateError instanceof Error ? updateError.message : "Unknown",
        });
      });
  }
}
