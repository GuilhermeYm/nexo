import { z } from "zod";

/**
 * Camada de classificação de documentos do Nexo.
 *
 * Dois provedores atendidos pelo mesmo código: **Groq** e **OpenAI**. Os dois
 * falam o mesmo dialeto de `chat/completions`, então o que muda entre eles é
 * endereço, chave e modelo — não vale uma segunda implementação.
 *
 * A ordem é Groq primeiro. A classificação roda **dentro do caminho do
 * upload** (`app/api/attachments/route.ts`), com a pessoa esperando por ela,
 * e é aí que a velocidade do Groq deixa de ser número de folheto e vira
 * experiência.
 *
 * Sem chave nenhuma — ou se a chamada falhar — cai no stub determinístico,
 * para o fluxo de upload continuar testável de ponta a ponta sem custo.
 */

const NOTE_TYPES = [
  "note",
  "task",
  "journal",
  "idea",
  "meeting",
  "document",
] as const;

const classificationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
  noteType: z.enum(NOTE_TYPES),
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(40))
    .min(1)
    .max(5),
});

export type DocumentClassification = z.infer<typeof classificationSchema>;

export interface ClassifyInput {
  /** Texto extraído do arquivo (pode ser vazio para áudio/binário). */
  text: string;
  filename: string;
  mimeType: string;
}

export interface ClassifyOutput {
  result: DocumentClassification;
  /** false => veio do stub (sem chave ou falha na API). */
  usedAi: boolean;
  /**
   * Por que o modelo não atendeu — quando houve um "por quê".
   *
   * **Este campo é a correção de um defeito concreto.** Antes, a falha morria
   * num `console.error` daqui e a linha de `ai_jobs` nascia `failed` com
   * `error = NULL`: o feed dizia "não consegui classificar" e jogava fora se
   * foi timeout, cota, modelo bloqueado na organização ou JSON malformado.
   * Horas depois, quando a pessoa reclamava, o log já havia rotacionado.
   *
   * Nulo em dois casos que **não** são falha: quando o modelo respondeu, e
   * quando não há chave nenhuma configurada — aí o stub é o comportamento
   * esperado desta instalação, não um defeito para investigar.
   */
  failure: ClassifyFailure | null;
}

export interface ClassifyFailure {
  /** Mensagem interna. Nunca vai crua ao cliente. */
  message: string;
  provider: string;
  model: string;
}

// ~8k chars bastam para classificar e mantêm o custo por chamada mínimo.
const MAX_INPUT_CHARS = 8000;

const SYSTEM_PROMPT = `Você é o organizador do aplicativo Nexo. Analise o documento do usuário e responda APENAS com um JSON no formato:
{"title": string, "summary": string, "noteType": "note"|"task"|"journal"|"idea"|"meeting"|"document", "tags": string[]}

Regras:
- "title": título curto e descritivo em português (máx. 200 chars).
- "summary": resumo fiel do conteúdo em português (máx. 2000 chars).
- "noteType": o tipo que melhor descreve o documento.
- "tags": de 1 a 5 tags em português, minúsculas, sem acentos, curtas (ex.: "financas", "reuniao", "ideia-app").
- Responda somente o JSON, sem markdown nem texto adicional.`;

interface Provider {
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
}

/**
 * Qual provedor atende esta instalação.
 *
 * Groq tem precedência quando as duas chaves existem — é o mais rápido, e
 * latência aqui é experiência. Trocar de provedor é trocar variável de
 * ambiente; nenhum componente sabe qual está no ar.
 */
function resolveProvider(): Provider | null {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return {
      name: "Groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: groqKey,
      // Um modelo pode ser descontinuado ou bloqueado no painel da
      // organização; por isso o default é sobrescrevível sem tocar no código.
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    };
  }

  return null;
}

export async function classifyDocument(
  input: ClassifyInput
): Promise<ClassifyOutput> {
  const provider = resolveProvider();

  if (!provider) {
    // Sem chave configurada não houve falha: é a instalação sem IA.
    return { result: stubClassification(input), usedAi: false, failure: null };
  }

  try {
    const result = await classifyWithProvider(input, provider);
    return { result, usedAi: true, failure: null };
  } catch (error) {
    // A falha nunca derruba o upload: o arquivo já está guardado, e uma nota
    // classificada pelo stub é melhor que nenhuma nota.
    //
    // Mas ela também não é mais **engolida** aqui. O `console.error` que
    // ficava neste lugar era a única testemunha do motivo, e ele rotaciona;
    // quem registra agora é a rota, que tem o usuário em mãos e devolve um
    // código para a linha do feed carregar.
    return {
      result: stubClassification(input),
      usedAi: false,
      failure: {
        message: error instanceof Error ? error.message : "Unknown",
        provider: provider.name,
        model: provider.model,
      },
    };
  }
}

async function classifyWithProvider(
  input: ClassifyInput,
  provider: Provider
): Promise<DocumentClassification> {
  const content = input.text.slice(0, MAX_INPUT_CHARS);

  const userPrompt = content
    ? `Arquivo: ${input.filename} (${input.mimeType})\n\nConteúdo:\n${content}`
    : `Arquivo: ${input.filename} (${input.mimeType})\n\nNão foi possível extrair texto; classifique pelo nome e tipo do arquivo.`;

  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    // Uma requisição que trava seguraria o upload junto com ela: a pessoa
    // fica olhando para a barra de progresso enquanto o provedor não
    // responde. Vinte segundos e o stub assume.
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 600,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    // O corpo do erro diz coisas úteis — modelo descontinuado, bloqueado na
    // organização, cota estourada. Vai para o log do servidor, nunca para o
    // cliente.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${provider.name} respondeu ${response.status}: ${detail.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error(`${provider.name} retornou resposta vazia`);
  }

  // Mesmo com `response_format: json_object`, um modelo pode devolver o JSON
  // embrulhado em cerca de markdown. Descascar aqui é mais barato que perder
  // a classificação para o stub por causa de três crases.
  const parsed = classificationSchema.safeParse(JSON.parse(unwrapJson(raw)));
  if (!parsed.success) {
    throw new Error(`JSON de ${provider.name} fora do formato esperado`);
  }

  return parsed.data;
}

/** Tira a cerca de markdown, quando o modelo insiste em colocá-la. */
function unwrapJson(raw: string): string {
  const trimmed = raw.trim();
  const fence = "```";
  if (!trimmed.startsWith(fence)) return trimmed;

  return trimmed
    .slice(fence.length)
    .replace(/^json\s*/i, "")
    .replace(new RegExp(`${fence}\\s*$`), "")
    .trim();
}

/** Classificação determinística usada sem chave de IA ou em caso de falha. */
function stubClassification(input: ClassifyInput): DocumentClassification {
  const baseName = input.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  const summary = input.text
    ? input.text.slice(0, 500).trim()
    : `Arquivo ${input.mimeType} aguardando classificação automática.`;

  return {
    title: baseName || input.filename,
    summary: summary || "Documento sem conteúdo de texto.",
    noteType: "document",
    tags: ["a-classificar"],
  };
}
