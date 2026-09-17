/**
 * Contas lembradas neste navegador, para trocar entre duas sem redigitar
 * e-mail toda vez.
 *
 * **Isto não é sessão.** Só guarda `id`, `email` e o nome de exibição — a
 * mesma coisa que já aparece em texto puro na aba Conta. Nenhum token,
 * nenhuma senha: a Nexo não mantém duas sessões vivas ao mesmo tempo (a
 * sessão do Supabase mora em cookie httpOnly, um por navegador), então trocar
 * de conta sempre passa por sair da atual e entrar na outra — isto aqui só
 * evita que a pessoa tenha que redigitar o e-mail nesse meio-tempo.
 */

const KNOWN_ACCOUNTS_KEY = "nexo-known-accounts";
const MAX_KNOWN_ACCOUNTS = 2;

/** Disparado no mesmo separador quando a lista de contas muda. */
export const ACCOUNTS_EVENT = "nexo-accounts";

export interface KnownAccount {
  id: string;
  email: string;
  displayName: string | null;
  lastUsedAt: number;
}

function isKnownAccount(value: unknown): value is KnownAccount {
  if (typeof value !== "object" || value === null) return false;
  const account = value as Partial<KnownAccount>;
  return (
    typeof account.id === "string" &&
    typeof account.email === "string" &&
    (typeof account.displayName === "string" || account.displayName === null) &&
    typeof account.lastUsedAt === "number"
  );
}

/**
 * A string crua do storage — estável entre chamadas quando nada mudou, ao
 * contrário de reconstruir o array a cada leitura. `useKnownAccounts` depende
 * disso: `useSyncExternalStore` compara o retrato por referência, e um array
 * novo a cada render entraria em loop (mesmo motivo do `useLocalDraft`).
 */
export function readKnownAccountsRaw(): string | null {
  try {
    return window.localStorage.getItem(KNOWN_ACCOUNTS_KEY);
  } catch {
    return null;
  }
}

/** O storage é editável pela pessoa: nada entra sem ser conferido. */
export function parseKnownAccounts(raw: string | null): KnownAccount[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isKnownAccount);
  } catch {
    return [];
  }
}

export function readKnownAccounts(): KnownAccount[] {
  return parseKnownAccounts(readKnownAccountsRaw());
}

function writeKnownAccounts(accounts: KnownAccount[]): void {
  try {
    window.localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // localStorage indisponível: a lista vale só para esta sessão.
  }
  window.dispatchEvent(new Event(ACCOUNTS_EVENT));
}

/**
 * Grava ou atualiza a conta pelo `id`, mais recente primeiro, e mantém só as
 * duas últimas — a terceira desaloja a mais antiga, nunca a atual.
 */
export function rememberAccount(
  account: Pick<KnownAccount, "id" | "email"> &
    Partial<Pick<KnownAccount, "displayName">>
): void {
  const current = readKnownAccounts().filter((entry) => entry.id !== account.id);
  const next: KnownAccount = {
    id: account.id,
    email: account.email,
    displayName: account.displayName ?? null,
    lastUsedAt: Date.now(),
  };
  writeKnownAccounts([next, ...current].slice(0, MAX_KNOWN_ACCOUNTS));
}

export function forgetAccount(id: string): void {
  writeKnownAccounts(readKnownAccounts().filter((entry) => entry.id !== id));
}
