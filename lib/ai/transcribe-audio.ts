import "server-only";

/** Transcrição de áudio pelos provedores que esta instância configurou. */

interface TranscriptionProvider {
  name: "Groq" | "OpenAI";
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface AudioTranscription {
  text: string;
  provider: string;
  model: string;
}

/**
 * A mesma escolha de provedor da classificação: Groq primeiro, OpenAI como
 * alternativa. As chaves ficam exclusivamente no servidor da instância.
 */
function resolveProvider(): TranscriptionProvider | null {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return {
      name: "Groq",
      endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
      apiKey: groqKey,
      model:
        process.env.GROQ_TRANSCRIPTION_MODEL ?? "whisper-large-v3-turbo",
    };
  }

  const openAiKey = process.env.OPENAI_API_KEY;
  if (openAiKey) {
    return {
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1/audio/transcriptions",
      apiKey: openAiKey,
      model:
        process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe",
    };
  }

  return null;
}

export function hasAudioTranscriptionProvider(): boolean {
  return resolveProvider() !== null;
}

/**
 * Converte um File já validado pelo upload em texto. O corpo é multipart — o
 * arquivo nunca ganha URL pública nem passa pelo navegador com uma API key.
 */
export async function transcribeAudio(file: File): Promise<AudioTranscription> {
  const provider = resolveProvider();
  if (!provider) throw new Error("Nenhum provedor de transcrição foi configurado.");

  const form = new FormData();
  form.set("file", file, file.name);
  form.set("model", provider.model);
  // json é a interseção estável entre Groq e OpenAI. Os timestamps podem ser
  // acrescentados depois sem mudar onde a transcrição mora: a nota da pessoa.
  form.set("response_format", "json");
  form.set("language", "pt");
  form.set("temperature", "0");

  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    // Não carregamos o corpo no erro: ele pode conter detalhes desnecessários
    // e o usuário só precisa do código de suporte gerado pelo worker.
    throw new Error(`${provider.name} respondeu ${response.status} ao transcrever.`);
  }

  const body = (await response.json()) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new Error(`${provider.name} retornou uma transcrição vazia.`);

  return { text, provider: provider.name, model: provider.model };
}
