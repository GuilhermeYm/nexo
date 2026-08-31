/**
 * O código do erro — o que a pessoa lê no telefone.
 *
 * `NX-7F3A-2K9`. Três coisas moldam este formato, e nenhuma delas é estética:
 *
 * 1. **Dita-se por voz.** O alfabeto não tem vogal (nenhuma palavra se forma
 *    por acidente, em nenhum idioma), nem `0`/`O`, `1`/`I`/`L`, `U`/`V` — os
 *    pares que quem escuta erra e quem lê de um celular rachado erra também.
 * 2. **Não é um uuid.** Trinta e seis caracteres com hífen não atravessam uma
 *    ligação, e um uuid é o tipo de coisa que alguém tenta adivinhar.
 * 3. **Diz de onde veio.** O prefixo `NX-` faz o código ser reconhecível fora
 *    de contexto — colado num e-mail de suporte, ele já se identifica.
 *
 * Sete caracteres num alfabeto de 26 dão ~8 bilhões de combinações. Não é
 * segredo (o código é opaco de propósito: quem o tem não ganha nada com ele),
 * é só espaço suficiente para colisão ser rara — e, quando acontece, quem
 * insere tenta de novo.
 *
 * Isomórfico de propósito: `crypto.getRandomValues` existe no Node e no
 * navegador, então este módulo pode ser importado dos dois lados sem arrastar
 * `node:crypto` para o bundle do cliente.
 */

/** Sem vogais, sem 0/O, 1/I/L, U/V. 26 símbolos. */
const ALPHABET = "23456789BCDFGHJKMNPQRSTWXZ";

/** O que a rota aceita na URL, e o que a interface reconhece no texto. */
export const ERROR_CODE_PATTERN = /^NX-[2-9BCDFGHJKMNPQRSTWXZ]{4}-[2-9BCDFGHJKMNPQRSTWXZ]{3}$/;

export function isErrorCode(value: unknown): value is string {
  return typeof value === "string" && ERROR_CODE_PATTERN.test(value);
}

/**
 * Cunha um código novo.
 *
 * O sorteio rejeita os valores que cairiam fora de um múltiplo exato do
 * alfabeto — sem isso, os primeiros símbolos sairiam com mais frequência que
 * os últimos. É um detalhe barato, e o contrário seria uma distribuição torta
 * de graça.
 */
export function mintErrorCode(): string {
  const symbols = pickSymbols(7);
  return `NX-${symbols.slice(0, 4).join("")}-${symbols.slice(4).join("")}`;
}

function pickSymbols(count: number): string[] {
  const out: string[] = [];
  // 256 não é múltiplo de 26: o resto (256 % 26 = 22) é a faixa que precisa
  // ser descartada para o sorteio ser uniforme.
  const ceiling = 256 - (256 % ALPHABET.length);
  const buffer = new Uint8Array(count * 2);

  while (out.length < count) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= ceiling) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === count) break;
    }
  }

  return out;
}
