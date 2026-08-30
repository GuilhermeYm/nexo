/**
 * Formatação de data e saudação do dashboard.
 *
 * Todas as funções recebem o "agora" como argumento em vez de chamar
 * `Date.now()` por dentro. Isso não é cerimônia: o servidor pinta o primeiro
 * estado e o cliente hidrata em cima dele, e uma função que lê o relógio
 * sozinha devolve valores diferentes nos dois lados — erro de hidratação
 * garantido. Passando o mesmo instante para os dois, o HTML bate; depois de
 * montado, o cliente troca o instante por um relógio de verdade.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Depois de quanto tempo sem nada novo um painel do dashboard passa a
 * mostrar o convite de repouso ("faz um tempo desde a última captura…").
 * 12h: quem volta no dia seguinte ou depois de uma pausa longa vê o convite;
 * quem está usando durante o dia, não.
 */
export const STALE_AFTER_MS = 12 * HOUR;

/** Fuso fixo para o formato absoluto sair igual no servidor e no cliente. */
const TIME_ZONE = "America/Sao_Paulo";

const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: TIME_ZONE,
});

const shortDateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

/** "agora", "há 4 min", "há 3 h", "ontem", "12 ago". */
export function formatRelative(value: Date | string, now: number): string {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(time)) return "";

  const elapsed = now - time;

  // Relógios dessincronizados entre cliente e servidor produzem futuro por
  // alguns segundos. "em -3 min" seria pior que arredondar para agora.
  if (elapsed < MINUTE) return "agora";
  if (elapsed < HOUR) return `há ${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `há ${Math.floor(elapsed / HOUR)} h`;
  if (elapsed < 2 * DAY) return "ontem";
  if (elapsed < 7 * DAY) return `há ${Math.floor(elapsed / DAY)} dias`;

  return shortDate.format(time);
}

/** Título do elemento `<time>`: a data completa, para quem passar o mouse. */
export function formatAbsolute(value: Date | string): string {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? "" : shortDateTime.format(time);
}

export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Saudação pela hora local de quem está lendo.
 *
 * O corte das 5h para "boa noite" é intencional: quem está usando a Nexo às
 * 3 da manhã não está começando o dia, e "bom dia" ali soa como um relógio
 * quebrado. A landing já fala com essa pessoa ("ideia às 2h").
 */
export function greetingFor(hour: number): string {
  if (hour < 5) return "Boa noite";
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/** Primeiro nome, para a saudação não virar um formulário. */
export function firstName(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}
