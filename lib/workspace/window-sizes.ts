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
 * Largura de uma janela recolhida: o bastante para o ícone e o nome, e nada
 * mais. Recolhida, a janela vira uma etiqueta — o tamanho guardado só volta a
 * valer quando ela reabre.
 */
export const COLLAPSED_WINDOW_WIDTH = 208;

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

/**
 * A largura que a janela realmente ocupa na lousa.
 *
 * Mesmo motivo do `frameHeightOf`: recolhida, a janela encolhe para caber só
 * o ícone e o nome, e a borracha, as flechas e o realce da ferramenta miram
 * o que se vê — não os ~460px que um PDF vai voltar a ocupar quando reabrir.
 */
export function frameWidthOf(window: {
  width: number;
  state: string;
}): number {
  return window.state === "minimized" ? COLLAPSED_WINDOW_WIDTH : window.width;
}

/**
 * O tamanho da janela de uma imagem: a proporção dela, cabendo numa caixa
 * de ~480×560, mais a barra de título.
 *
 * O tamanho padrão de anexo tem forma de página A4 — certo para PDF, errado
 * para um print de tela deitado, que nasceria espremido numa faixa com duas
 * sobras cinzas. Sem as medidas (sharp ausente ou imagem que ele não leu), a
 * janela usa o padrão e a imagem se ajusta dentro dela.
 *
 * Nunca amplia: um ícone de 64 px continua pequeno, só respeita o mínimo de
 * largura que a validação aceita (160).
 */
export function imageWindowSize(image: {
  width: number;
  height: number;
}): { width: number; height: number } {
  const maxWidth = 480;
  const maxBodyHeight = 560 - COLLAPSED_WINDOW_HEIGHT;
  const scale = Math.min(maxWidth / image.width, maxBodyHeight / image.height, 1);
  const snap = (value: number) => Math.round(value / 8) * 8;
  return {
    width: Math.max(160, snap(image.width * scale)),
    height: Math.max(96, snap(image.height * scale + COLLAPSED_WINDOW_HEIGHT)),
  };
}
