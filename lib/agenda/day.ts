/**
 * O dia da Agenda, como chave e como rótulo.
 *
 * Puro e **sem `server-only`** de propósito: o cliente decide qual dia está
 * olhando (só ele conhece o fuso do aparelho) e o servidor formata o título
 * da nota. Os dois precisam da mesma aritmética, e duas implementações
 * divergiriam no pior lugar possível — a fronteira da meia-noite.
 *
 * ## A armadilha que mora neste arquivo
 *
 * `toISOString()` é **UTC**, e usá-lo aqui reintroduz o defeito inteiro: 21h
 * de 30/08 em São Paulo é 00h de 31/08 em UTC, e a pessoa escreveria na lista
 * de amanhã. Pelo mesmo motivo `new Date("2026-08-30")` é lido como
 * meia-noite UTC — formatado em UTC−3, imprime "29 de agosto".
 *
 * A regra, então: nunca dar a volta por uma string de data crua. Parse para
 * `(ano, mês, dia)` inteiros; `new Date(y, m - 1, d)` quando o resultado é
 * local, `Date.UTC(...)` com `timeZone: "UTC"` no `Intl` quando não é.
 */

/** `YYYY-MM-DD`. O formato aceito pela rota e gravado em `notes.task_date`. */
export const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O dia local de quem está olhando, como chave.
 *
 * Montado a partir dos getters locais do `Date` — nunca de `toISOString()`.
 */
export function localDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** As três partes de uma chave de dia, ou `null` se ela não for uma. */
export function parseDayKey(
  key: string
): { year: number; month: number; day: number } | null {
  if (!DAY_KEY_PATTERN.test(key)) return null;
  const [year, month, day] = key.split("-").map(Number);

  // `2026-02-31` passa no regex. E não dá para conferir com
  // `new Date("2026-02-31")`, porque o JS **rola** para 03/03 em vez de
  // recusar. Reconstruir e comparar é a checagem que de fato pega.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** `true` quando a chave é um dia que existe no calendário. */
export function isDayKey(key: string): boolean {
  return parseDayKey(key) !== null;
}

/** Soma dias a uma chave, devolvendo outra chave. Usado por "ontem"/"amanhã". */
export function addDays(key: string, amount: number): string {
  const parts = parseDayKey(key);
  if (!parts) return key;
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  probe.setUTCDate(probe.getUTCDate() + amount);
  return `${probe.getUTCFullYear()}-${String(probe.getUTCMonth() + 1).padStart(2, "0")}-${String(
    probe.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * O título com que a nota do dia nasce.
 *
 * Vai para `notes.title`, que alimenta `search_vector` — então a lista fica
 * achável pela busca por "agenda" ou pelo mês. O `timeZone: "UTC"` não é
 * detalhe: sem ele, o runtime do servidor formataria a meia-noite UTC no
 * próprio fuso e imprimiria o dia anterior.
 */
export function agendaTitle(key: string): string {
  const parts = parseDayKey(key);
  if (!parts) return "Agenda";
  const label = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
  return `Agenda — ${label}`;
}

/**
 * Como o dia aparece na tela: "Hoje", "Ontem", "Amanhã" ou o dia por extenso.
 *
 * O dia por extenso ("sábado, 29 de agosto") e não só um número é o que
 * permite a quem está com o relógio do aparelho errado perceber sozinho — o
 * servidor não tem como saber disso.
 */
export function dayLabel(key: string, today: string): string {
  if (key === today) return "Hoje";
  if (key === addDays(today, -1)) return "Ontem";
  if (key === addDays(today, 1)) return "Amanhã";

  const parts = parseDayKey(key);
  if (!parts) return key;

  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  const label = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));

  return label.charAt(0).toUpperCase() + label.slice(1);
}
