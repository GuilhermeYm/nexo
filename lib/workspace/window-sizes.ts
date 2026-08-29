/**
 * Tamanho inicial de cada tipo de janela.
 *
 * Mora fora de `lib/validations/workspace.ts` porque quem precisa dele são os
 * dois lados: o servidor, para gravar a janela nova, e a lousa, para calcular
 * onde centralizá-la. Deixá-lo junto das validações obrigaria o cliente a
 * carregar o Zod só para saber a altura de um post-it.
 */
export const DEFAULT_WINDOW_SIZE: Record<
  "note" | "sticky" | "text" | "attachment",
  { width: number; height: number }
> = {
  note: { width: 340, height: 260 },
  sticky: { width: 240, height: 200 },
  text: { width: 320, height: 140 },
  // Proporção de página A4 com folga para a barra de páginas: é a forma que
  // um documento tem, e abrir um PDF numa janela quadrada obriga a
  // redimensionar antes de conseguir ler a primeira linha.
  attachment: { width: 460, height: 620 },
};

/**
 * Altura de uma janela recolhida: só a barra de título, o `h-9` do
 * `WindowFrame`.
 */
export const COLLAPSED_WINDOW_HEIGHT = 36;

/**
 * A altura que a janela realmente ocupa na lousa.
 *
 * Recolhida, ela é só a barra de título. O valor guardado continua sendo a
 * altura de quando ela for expandida, e usar ele aqui faz a borracha apagar
 * o que está logo abaixo de uma janela recolhida sem encostar em nada
 * visível — e a flecha encostar no vazio, em vez de na barra.
 */
export function frameHeightOf(window: {
  height: number;
  state: string;
}): number {
  return window.state === "minimized" ? COLLAPSED_WINDOW_HEIGHT : window.height;
}
