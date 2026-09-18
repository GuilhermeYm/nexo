import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { classifyDocument } from "@/lib/ai/classify-document";
import { transcribeAudio } from "@/lib/ai/transcribe-audio";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { aiJobs, noteTags, notes, tags } from "@/lib/db/schema";
import { redactAndTrim } from "@/lib/errors/redact";
import { reportError } from "@/lib/errors/report";
import { invalidateNoteListCache } from "@/lib/notes/cache";

interface ProcessAudioTranscriptionInput {
  file: File;
  filename: string;
  mimeType: string;
  userId: string;
  noteId: string;
  jobId: string;
  request: Request;
}

/**
 * Worker disparado depois da resposta do upload. A nota já existe antes dele
 * começar; portanto um timeout ou uma chave ausente nunca faz o áudio sumir.
 */
export async function processAudioTranscription(
  input: ProcessAudioTranscriptionInput
): Promise<void> {
  const startedAt = new Date();

  try {
    await db
      .update(aiJobs)
      .set({ status: "running", startedAt })
      .where(and(eq(aiJobs.id, input.jobId), eq(aiJobs.userId, input.userId)));

    const transcription = await transcribeAudio(input.file);
    const classification = await classifyDocument({
      text: transcription.text,
      filename: input.filename,
      mimeType: input.mimeType,
    });

    const transcriptContent = [
      classification.result.summary,
      "",
      "Transcrição",
      transcription.text,
    ].join("\n");

    await db
      .update(notes)
      .set({
        title: classification.result.title,
        content: transcriptContent,
        type: classification.result.noteType,
        source: classification.usedAi ? "ai" : "user",
      })
      .where(and(eq(notes.id, input.noteId), eq(notes.userId, input.userId)));

    // Só acrescenta tags. Apagar as existentes poderia remover uma tag que a
    // pessoa colocou enquanto a transcrição ainda estava em andamento.
    const tagNames = [
      ...new Set(classification.result.tags.map((tag) => tag.toLowerCase())),
    ];
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
          .returning({ id: tags.id })
      : [];
    const tagIds = [...existing.map((tag) => tag.id), ...created.map((tag) => tag.id)];
    if (tagIds.length) {
      await db
        .insert(noteTags)
        .values(tagIds.map((tagId) => ({ noteId: input.noteId, tagId })))
        .onConflictDoNothing();
    }

    const finishedAt = new Date();
    const detail = classification.usedAi
      ? "Transcrição pronta; a nota foi resumida, classificada e marcada."
      : "Transcrição pronta. A classificação automática não respondeu; revise o tipo e as tags quando quiser.";
    await db
      .update(aiJobs)
      .set({
        status: "succeeded",
        label: `Transcreveu ${input.filename}`,
        detail,
        result: {
          provider: transcription.provider,
          model: transcription.model,
          transcriptChars: transcription.text.length,
          classified: classification.usedAi,
        },
        finishedAt,
      })
      .where(and(eq(aiJobs.id, input.jobId), eq(aiJobs.userId, input.userId)));

    await writeAuditLog({
      action: "UPDATE",
      tableName: "notes",
      recordId: input.noteId,
      userId: input.userId,
      // O conteúdo falado nunca vai para a auditoria.
      oldData: { transcription: "pending" },
      newData: {
        transcription: "completed",
        transcriptChars: transcription.text.length,
      },
      request: input.request,
    });
    await invalidateNoteListCache(input.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    const code = await reportError({
      route: "audio transcription worker",
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
        label: `Não conseguiu transcrever ${input.filename}`,
        detail: `O áudio continua guardado. Informe o código ${code} se quiser ajuda para investigar.`,
        error: redactAndTrim(message, 1000),
        errorCode: code,
        finishedAt: new Date(),
      })
      .where(and(eq(aiJobs.id, input.jobId), eq(aiJobs.userId, input.userId)))
      .catch((updateError) => {
        console.error("[AI] Não foi possível registrar falha de transcrição", {
          jobId: input.jobId,
          error: updateError instanceof Error ? updateError.message : "Unknown",
        });
      });
  }
}
