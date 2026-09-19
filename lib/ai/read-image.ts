import "server-only";

import { z } from "zod";

import {
  NOTE_TYPES,
  parseUsage,
  reasoningParams,
  unwrapJson,
  type Provider,
  type TokenUsage,
} from "@/lib/ai/classify-document";
import type { ReasoningEffort } from "@/lib/ai/preference-options";

/**
 * A IA olhando uma imagem: descreve, transcreve o texto que aparece nela,
 * tipa e marca — numa chamada só.
 *
 * Mesmo desenho da transcrição de áudio (`transcribe-audio.ts`): o provedor
 * vem das variáveis de ambiente da instância, a chave nunca sai do servidor e
 * o arquivo não ganha URL pública — a imagem vai no corpo da requisição, em
 * base64. Ver `docs/IMAGENS.md`.
 *
 * **Visão é opt-in por modelo, não por chave.** Ter `GROQ_API_KEY` não basta:
 * o modelo de texto padrão do Groq (`gpt-oss-120b`) não enxerga, e mandar uma
 * imagem para ele é 400 pago em latência. Por isso o Groq só lê imagem com
 * `GROQ_VISION_MODEL` definido; a OpenAI tem um padrão que enxerga
 * (`gpt-4.1-mini` — ver `DEFAULT_OPENAI_VISION_MODEL`). Sem nenhum dos dois,
 * a imagem fica guardada e a tarefa em `waiting_configuration` — nunca uma
 * descrição inventada pelo nome.
 */

/**
 * O modelo de visão padrão da OpenAI.
 *
 * Medido em 19/09/2026 com um recibo de 1200×600 (texto em quatro linhas),
 * a mesma imagem nos quatro, todos transcrevendo certo o que importa:
 *
 * | modelo        | tokens de entrada | tempo  |
 * |---------------|-------------------|--------|
 * | gpt-4o-mini   | 36.863            | 1,8 s  |
 * | gpt-4.1-mini  | 1.197             | 1,1 s  |
 * | gpt-4.1-nano  | 1.804             | 1,1 s  | (errou a caixa de uma palavra)
 * | gpt-5-mini    | 893               | 1,2 s  | (modelo de raciocínio)
 *
 * O `gpt-4o-mini` conta cada ladrilho de imagem como ~33× o do `gpt-4o`, para
 * custar o mesmo que ele: é o mais barato por token de texto e o mais caro
 * por imagem — cerca de 11× o `gpt-4.1-mini` aqui. O 4.1-mini conta por
 * retalhos de 32 px, sem o multiplicador.
 */
const DEFAULT_OPENAI_VISION_MODEL = "gpt-4.1-mini";

/**
 * O lado mais longo que a imagem pode ter ao ir para o modelo.
 *
 * O custo de uma imagem cresce com a área (retalhos de 32 px no 4.1-mini, com
 * teto de 1.536 retalhos): uma foto de celular de 4032×3024 bateria no teto;
 * reduzida a 1.536 px no lado maior, fica em ~1.700 tokens, e o texto de um
 * print ou de um documento fotografado continua legível. Também é o que faz a
 * foto caber no teto de 4 MB em base64 do Groq.
 */
const MAX_VISION_SIDE = 1536;

/** Teto do corpo em base64 que o Groq aceita; a OpenAI aceita 20 MB. */
const GROQ_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const OPENAI_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const readingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  // O texto que aparece na imagem. Vazio quando não há texto — foto de
  // paisagem, desenho, gráfico sem legenda.
  text: z.string().trim().max(8000).default(""),
  noteType: z.enum(NOTE_TYPES),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).min(1).max(5),
});

export type ImageReading = z.infer<typeof readingSchema>;

export interface ImageReadingResult {
  reading: ImageReading;
  provider: string;
  model: string;
  usage: TokenUsage | null;
  /** Bytes que de fato foram ao modelo, depois da redução. */
  sentBytes: number;
}

const SYSTEM_PROMPT = `Você é o organizador do aplicativo Nexo. O usuário guardou uma imagem. Olhe para ela e responda APENAS com um JSON no formato:
{"title": string, "description": string, "text": string, "noteType": "note"|"task"|"journal"|"idea"|"meeting"|"document", "tags": string[]}

Regras:
- "title": título curto e descritivo em português (máx. 200 chars).
- "description": o que a imagem mostra e para que ela parece servir, em português (máx. 2000 chars). Descreva o que se vê; não invente o que não está lá.
- "text": todo o texto legível na imagem, transcrito como está, na língua original. String vazia se não houver texto.
- "noteType": o tipo que melhor descreve o conteúdo (um print de conversa sobre tarefas é "task"; uma lousa de reunião é "meeting"; uma foto de documento é "document").
- "tags": de 1 a 5 tags em português, minúsculas, sem acentos, curtas (ex.: "recibo", "print", "diagrama").
- Responda somente o JSON, sem markdown nem texto adicional.`;

/**
 * Quem lê imagens nesta instalação.
 *
 * Groq primeiro quando ele tem um modelo de visão declarado — mesma ordem da
 * classificação, pela latência. Senão a OpenAI, com o padrão que enxerga.
 */
export function resolveVisionProvider(): Provider | null {
  const groqKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_VISION_MODEL?.trim();
  if (groqKey && groqModel) {
    return {
      name: "Groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: groqKey,
      model: groqModel,
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: openaiKey,
      model: process.env.OPENAI_VISION_MODEL?.trim() || DEFAULT_OPENAI_VISION_MODEL,
    };
  }

  return null;
}

export function hasImageReadingProvider(): boolean {
  if (process.env.AI_IMAGE_READING === "off") return false;
  return resolveVisionProvider() !== null;
}

/**
 * O que falta para esta instância ler imagens, em uma frase — vai para o
 * detalhe da tarefa em `waiting_configuration`.
 */
export function imageReadingSetupHint(): string {
  if (process.env.AI_IMAGE_READING === "off") {
    return "A leitura de imagens está desligada nesta instância (AI_IMAGE_READING=off).";
  }
  if (process.env.GROQ_API_KEY) {
    return "Defina GROQ_VISION_MODEL com um modelo do Groq que aceite imagens, ou configure OPENAI_API_KEY, e envie a imagem de novo.";
  }
  return "Configure OPENAI_API_KEY (ou GROQ_API_KEY com GROQ_VISION_MODEL) nesta instância e envie a imagem de novo.";
}

/**
 * Reduz e normaliza a imagem antes de ela ir ao modelo.
 *
 * `rotate()` aplica a orientação do EXIF — sem isso uma foto de celular em pé
 * chega deitada ao modelo, que lê o texto de lado. JPEG na saída porque é o
 * menor para foto e todo provedor aceita; o original no Storage não muda.
 *
 * `sharp` é importado sob demanda: sem ele (instalação que o pulou), a
 * imagem segue como veio, e o teto do provedor decide se ela passa.
 */
async function prepareImage(
  file: Blob,
  mimeType: string
): Promise<{ bytes: Buffer; mimeType: string }> {
  const original = Buffer.from(await file.arrayBuffer());
  try {
    const { default: sharp } = await import("sharp");
    const bytes = await sharp(original, { animated: false })
      .rotate()
      .resize({
        width: MAX_VISION_SIDE,
        height: MAX_VISION_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      // Transparência vira branco: um PNG de fundo transparente com texto
      // preto sairia preto sobre preto no JPEG.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { bytes, mimeType: "image/jpeg" };
  } catch {
    return { bytes: original, mimeType };
  }
}

export async function readImage(
  file: Blob,
  mimeType: string,
  options: { filename: string; reasoningEffort?: ReasoningEffort }
): Promise<ImageReadingResult> {
  const provider = resolveVisionProvider();
  if (!provider) throw new Error("Nenhum provedor de visão foi configurado.");

  const prepared = await prepareImage(file, mimeType);
  const limit =
    provider.name === "Groq" ? GROQ_MAX_IMAGE_BYTES : OPENAI_MAX_IMAGE_BYTES;
  // base64 cresce 4/3: o teto do provedor é sobre o texto, não sobre os bytes.
  if (Math.ceil(prepared.bytes.length / 3) * 4 > limit) {
    throw new Error(
      `A imagem passa do limite de ${Math.round(limit / 1024 / 1024)} MB que ${provider.name} aceita para leitura.`
    );
  }
  const dataUrl = `data:${prepared.mimeType};base64,${prepared.bytes.toString("base64")}`;

  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    // Roda depois da resposta do upload (`after()`), então não segura a
    // pessoa — mas também não pode segurar a instância para sempre.
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              // O nome às vezes é a melhor pista ("recibo-mercado.jpg"), mas
              // ele entra como pista, depois da imagem na ordem de peso.
              text: `Nome do arquivo: ${options.filename}`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1500,
      temperature: 0.2,
      ...reasoningParams(provider, options.reasoningEffort),
    }),
  });

  if (!response.ok) {
    // O corpo é lido para o log do servidor, cortado; nunca vai ao cliente.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${provider.name} respondeu ${response.status} ao ler a imagem: ${detail.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: unknown;
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new Error(`${provider.name} retornou resposta vazia ao ler a imagem.`);

  const parsed = readingSchema.safeParse(JSON.parse(unwrapJson(raw)));
  if (!parsed.success) {
    throw new Error(`JSON de ${provider.name} fora do formato esperado ao ler a imagem.`);
  }

  return {
    reading: parsed.data,
    provider: provider.name,
    model: provider.model,
    usage: parseUsage(payload.usage),
    sentBytes: prepared.bytes.length,
  };
}

/**
 * Largura e altura da imagem, para a janela da lousa nascer na proporção
 * certa. Nulo quando `sharp` não está disponível ou não reconhece o arquivo —
 * a janela então usa o tamanho padrão.
 */
export async function readImageSize(
  file: Blob
): Promise<{ width: number; height: number } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    if (!meta.width || !meta.height) return null;
    // Orientações 5–8 do EXIF são de 90°: a foto em pé vem gravada deitada.
    const turned = (meta.orientation ?? 1) >= 5;
    return turned
      ? { width: meta.height, height: meta.width }
      : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}
