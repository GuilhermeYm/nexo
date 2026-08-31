import "server-only";

/**
 * O que **não** pode entrar em `error_reports`.
 *
 * Esta tabela existe para o suporte ler. Isso muda a natureza do texto que
 * vai para ela: um `console.error` some na rotação do log em algumas horas e
 * é lido por quem já tem acesso ao servidor; uma linha no banco fica noventa
 * dias e é lida por quem responde o chamado. O que serve para um não serve
 * automaticamente para o outro.
 *
 * E a mensagem de erro é justamente onde o segredo vaza sem ninguém decidir:
 *
 * - o `pg` põe **o valor da linha** no texto de uma violação de unicidade;
 * - um `fetch` que falha carrega a URL inteira, com querystring;
 * - a Groq devolve o corpo do 401 — que às vezes ecoa o começo da chave;
 * - um `DATABASE_URL` mal formado aparece cru no erro de conexão.
 *
 * Nenhum desses casos é culpa de quem escreveu o `catch`. Por isso a censura
 * é do lado de quem grava, e não uma regra para os chamadores lembrarem.
 *
 * **O que ela não é.** Não é anonimização: um texto livre continua podendo
 * dizer coisas sobre a pessoa, e é por isso que `message` e `stack` **nunca
 * saem do servidor** (GRANT por coluna em 0015, e a rota de leitura não os
 * seleciona). A censura é a segunda tranca, não a primeira.
 */

/** Ordem importa pouco; nenhum padrão consome o do outro. */
const PATTERNS: [RegExp, string][] = [
  // JWT — o access token do Supabase, e o `service_role` se alguém o logar.
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, "<jwt>"],
  // Chaves de API com prefixo declarado: sk-… (OpenAI), gsk_… (Groq),
  // sb_… / sbp_… (Supabase), whsec_… (Stripe webhook), pk_/rk_ (Stripe).
  [/\b(?:sk|gsk|sbp|sb|whsec|pk|rk)[-_][A-Za-z0-9_-]{8,}/gi, "<key>"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <token>"],
  // Credencial dentro de URL: postgres://user:senha@host, https://x:y@host.
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, "$1<credential>@"],
  // E-mail — PII, e o único identificador de pessoa que costuma vazar em
  // mensagem de erro ("usuário fulano@… não encontrado").
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "<email>"],
];

/** Censura uma string. Sempre devolve string (nunca `undefined`). */
export function redact(value: string): string {
  let out = value;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Censura e corta. O corte vem depois, senão um teto curto partiria um JWT
 *  ao meio e a metade que sobra passaria pela censura sem ser reconhecida. */
export function redactAndTrim(value: string, max: number): string {
  const clean = redact(value).trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Chaves que nunca entram em `context`, mesmo com valor aparentemente inócuo.
 *
 * A lista é por **nome**, e não por conteúdo, porque o nome é o que o
 * chamador controla: quem escreve `{ storagePath }` num `extra` está dizendo
 * o que aquilo é, e a resposta é "isso não vai para a tabela". `content`,
 * `body`, `title` e `text` estão aqui pelo mesmo motivo que a busca não
 * indexa HTML: conteúdo de nota é a coisa que o produto promete guardar, não
 * material de diagnóstico.
 */
const FORBIDDEN_KEYS =
  /^(?:.*(?:token|secret|password|senha|authorization|apikey|api_key|credential).*|key|storagepath|storage_path|signedurl|signed_url|content|contentrich|content_rich|body|text|title|summary|email|filename|cookie)$/i;

/** Um valor de `context` pode ter no máximo isto de texto. */
const MAX_VALUE_CHARS = 300;
/** E o objeto inteiro, no máximo estes campos. */
const MAX_KEYS = 20;

/**
 * Deixa `context` em condição de ser gravado: só primitivos, só chaves que
 * não se anunciam como sensíveis, cada valor censurado e curto.
 *
 * Objetos e arrays aninhados **saem inteiros** em vez de serem percorridos.
 * Não é preguiça: o valor de diagnóstico de um `{ model, status }` é alto e o
 * de um payload inteiro é baixo, enquanto o risco é o contrário. Quem precisa
 * de um campo de dentro passa ele achatado.
 */
export function sanitizeContext(
  input: Record<string, unknown> | null | undefined
): Record<string, string | number | boolean> | null {
  if (!input) return null;

  const out: Record<string, string | number | boolean> = {};
  let count = 0;

  for (const [key, value] of Object.entries(input)) {
    if (count >= MAX_KEYS) break;
    if (FORBIDDEN_KEYS.test(key)) continue;
    if (value === null || value === undefined) continue;

    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      const clean = redactAndTrim(value, MAX_VALUE_CHARS);
      if (clean.length === 0) continue;
      out[key] = clean;
    } else {
      continue;
    }

    count += 1;
  }

  return count > 0 ? out : null;
}
