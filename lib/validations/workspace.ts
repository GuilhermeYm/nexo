import { z } from "zod";

import { richDocumentSchema } from "@/lib/editor/document";
import { NOTE_FONT_IDS } from "@/lib/editor/note-fonts";
import {
  ABSOLUTE_BOARD_MARKS_PER_BOARD,
  ABSOLUTE_CONNECTIONS_PER_BOARD,
  ABSOLUTE_WINDOWS_PER_BOARD,
} from "@/lib/limits";
import {
  CONNECTION_HEADS,
  CONNECTION_STROKES,
  CONNECTION_TONES,
  CONNECTION_WEIGHTS,
} from "@/lib/workspace/connection-style";

/**
 * Validação das janelas da lousa.
 *
 * Os limites numéricos são os mesmos das constraints `CHECK` da migration
 * 0007. Estão nos dois lugares de propósito: aqui para o cliente receber um
 * 400 com sentido, e no banco porque é lá que a garantia mora — uma rota
 * pode ser esquecida, uma constraint não.
 */

const coordinate = z.number().int().min(-200_000).max(200_000);
const width = z.number().int().min(160).max(4000);
const height = z.number().int().min(96).max(4000);

/** Uma das seis matizes de tag do tema, por posição. Cor livre não entra. */
export const toneSchema = z.enum(["1", "2", "3", "4", "5", "6"]);
export const backgroundToneSchema = z.enum([
  "none",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
]);
export const textToneSchema = z.enum([
  "default",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
]);

export const windowStateSchema = z.enum([
  "normal",
  "minimized",
  "maximized",
]);

/**
 * Criar uma janela.
 *
 * Três casos num schema só, separados pelo `superRefine`:
 *   - abrir uma nota que já existe  → kind "note" + noteId
 *   - criar uma nota nova na lousa  → kind "note" + title
 *   - post-it ou caixa de texto     → kind "sticky" | "text"
 */
export const createWindowSchema = z
  .object({
    kind: z.enum(["note", "sticky", "text", "attachment"]).default("note"),
    noteId: z.uuid().optional(),
    attachmentId: z.uuid().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    text: z.string().max(4000).optional(),
    tone: toneSchema.optional(),
    backgroundTone: backgroundToneSchema.optional(),
    textTone: textToneSchema.optional(),
    // Opcionais: quem abre uma nota vindo do dashboard não está olhando
    // para a lousa e não tem como escolher um ponto. Sem eles, o servidor
    // coloca a janela logo abaixo do que já existe — sempre ao alcance do
    // enquadramento de quem chegar lá.
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: width.optional(),
    height: height.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.kind !== "text" &&
      (value.backgroundTone !== undefined || value.textTone !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Só a caixa de texto tem fundo e cor de texto próprios.",
      });
    }

    if (value.kind === "attachment") {
      if (!value.attachmentId) {
        ctx.addIssue({
          code: "custom",
          message: "Uma janela de anexo precisa do id do anexo.",
        });
      }
      if (value.noteId || value.title) {
        ctx.addIssue({
          code: "custom",
          message: "Uma janela de anexo não aponta para uma nota.",
        });
      }
      return;
    }

    if (value.attachmentId) {
      ctx.addIssue({
        code: "custom",
        message: "Só a janela de anexo aponta para um anexo.",
      });
      return;
    }

    if (value.kind === "note") {
      const hasExisting = Boolean(value.noteId);
      const hasNew = Boolean(value.title);

      if (hasExisting === hasNew) {
        ctx.addIssue({
          code: "custom",
          message:
            "Uma janela de nota abre uma nota existente (noteId) ou cria uma nova (title) — nunca as duas.",
        });
      }
      return;
    }

    // Post-it e caixa de texto não apontam para nota nenhuma: a constraint
    // `workspace_windows_kind_matches_note` recusaria a linha.
    if (value.noteId || value.title) {
      ctx.addIssue({
        code: "custom",
        message: "Elementos da lousa não apontam para uma nota.",
      });
    }
  });

/**
 * Atualizar uma janela.
 *
 * Tudo opcional: o arraste manda só a geometria, o editor manda só o texto, o
 * clique manda só o `zIndex`. Um corpo vazio é recusado — seria uma escrita
 * sem efeito ocupando uma linha do audit log.
 */
export const updateWindowSchema = z
  .object({
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: width.optional(),
    height: height.optional(),
    zIndex: z.number().int().min(0).max(1_000_000).optional(),
    state: windowStateSchema.optional(),
    text: z.string().max(4000).optional(),
    tone: toneSchema.optional(),
    backgroundTone: backgroundToneSchema.optional(),
    textTone: textToneSchema.optional(),
    borderless: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nada para atualizar.",
  });

/**
 * Editar uma nota — pelo editor ou pela janela da lousa.
 *
 * `content` e `contentRich` podem chegar juntos, mas não são iguais em
 * autoridade: quando o documento vem, é dele que o servidor deriva o texto, e
 * o `content` enviado pelo cliente é descartado. Assim não existe requisição
 * capaz de fazer a busca indexar uma coisa e o editor mostrar outra.
 */
/**
 * Uma referência da nota. Só `http:`/`https:`: o `href` vai para a tela e
 * para o PDF, e um `javascript:` guardado aqui viraria script no clique.
 */
export const noteReferenceSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    }, "Use um link que comece com http:// ou https://."),
  title: z.string().trim().max(200),
});

/** Teto repetido no CHECK da 0032. */
export const MAX_NOTE_REFERENCES = 50;

export const updateNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().max(100_000).optional(),
    contentRich: richDocumentSchema.optional(),
    references: z
      .array(noteReferenceSchema)
      .max(MAX_NOTE_REFERENCES, "No máximo 50 referências por nota.")
      .optional(),
    font: z.enum(NOTE_FONT_IDS).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nada para atualizar.",
  });

export type CreateWindowInput = z.infer<typeof createWindowSchema>;
export type UpdateWindowInput = z.infer<typeof updateWindowSchema>;

// Os tamanhos moram em lib/workspace/window-sizes.ts — a lousa precisa deles
// para centralizar a janela nova, e não deve carregar o Zod por causa disso.
export { DEFAULT_WINDOW_SIZE } from "@/lib/workspace/window-sizes";

/* ---------------------------------------------------------------------- */
/* Ligações                                                                */
/* ---------------------------------------------------------------------- */

/**
 * Ligar dois elementos.
 *
 * Só os dois ids: a direção é a ordem deles, e onde a flecha encosta na tela
 * é geometria calculada a partir das janelas — não é palavra do cliente.
 *
 * Que as duas pontas estejam **nesta lousa** não é conferido aqui: quem
 * garante isso é a chave estrangeira de três colunas
 * (`workspace_connections_from_fk`). A rota confere antes só para o cliente
 * receber um 404 explicado em vez de um 500 de constraint.
 */
export const createConnectionSchema = z
  .object({
    fromWindowId: z.uuid(),
    toWindowId: z.uuid(),
  })
  .refine((value) => value.fromWindowId !== value.toWindowId, {
    message: "Um elemento não se liga a ele mesmo.",
  });

/**
 * O rótulo da flecha.
 *
 * Texto vazio é o gesto de **apagar** o rótulo, não um valor: a coluna é nula
 * quando não há rótulo, e deixar a string vazia entrar criaria um segundo
 * jeito de escrever o mesmo estado. Por isso o `transform` para `null` em vez
 * de um `.min(1)` que recusaria quem só quer limpar o campo.
 *
 * O teto de 80 é o mesmo do CHECK em 0012 — quem passar direto pelo
 * PostgREST esbarra no banco.
 */
const connectionLabel = z
  .string()
  .max(80, "No máximo 80 caracteres.")
  // Quebra de linha viraria uma etiqueta de duas alturas em cima de um
  // traço; o que precisa de parágrafo precisa de uma nota.
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

/** A aparência da flecha — os mesmos enums do CHECK de 0019. */
const connectionStyleShape = {
  tone: z.enum(CONNECTION_TONES).nullable(),
  stroke: z.enum(CONNECTION_STROKES),
  weight: z.enum(CONNECTION_WEIGHTS),
  heads: z.enum(CONNECTION_HEADS),
};

/**
 * O que o inspetor da ligação muda: o rótulo e a aparência, cada campo
 * opcional — um clique numa amostra manda só a cor. `strict` porque origem e
 * destino não se editam por aqui, e um campo a mais é engano ou tentativa.
 */
export const connectionPatchSchema = z
  .object({
    label: connectionLabel.optional(),
    tone: connectionStyleShape.tone.optional(),
    stroke: connectionStyleShape.stroke.optional(),
    weight: connectionStyleShape.weight.optional(),
    heads: connectionStyleShape.heads.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nada para mudar.",
  });

/* ---------------------------------------------------------------------- */
/* Caneta e formas                                                        */
/* ---------------------------------------------------------------------- */

const markPoint = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

export const createBoardMarkSchema = z
  .object({
    kind: z.enum(["pen", "rectangle", "ellipse", "diamond"]),
    points: z.array(markPoint).max(2048),
    x: coordinate,
    y: coordinate,
    width: z.number().int().min(1).max(400_000),
    height: z.number().int().min(1).max(400_000),
    tone: z.enum(["default", "1", "2", "3", "4", "5", "6"]),
    weight: z.number().int().min(1).max(12),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "pen" && value.points.length < 2) {
      ctx.addIssue({ code: "custom", message: "Um traço precisa de ao menos dois pontos." });
    }
    if (value.kind !== "pen" && value.points.length !== 0) {
      ctx.addIssue({ code: "custom", message: "Formas não recebem pontos livres." });
    }
    for (const point of value.points) {
      if (point.x < 0 || point.y < 0 || point.x > value.width || point.y > value.height) {
        ctx.addIssue({ code: "custom", message: "Ponto fora dos limites do traço." });
        break;
      }
    }
  });

export const deleteBoardMarksSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(ABSOLUTE_BOARD_MARKS_PER_BOARD),
}).strict();

export type ConnectionPatch = z.infer<typeof connectionPatchSchema>;

/**
 * Uma ligação como o "Desfazer" da borracha a devolve.
 *
 * O rótulo volta junto: ele é conteúdo escrito pela pessoa, e restaurar a
 * flecha sem o texto dela seria desfazer só metade da apagada — a mesma razão
 * pela qual o `source` da janela volta como veio.
 */
const restorableConnectionSchema = z
  .object({
    fromWindowId: z.uuid(),
    toWindowId: z.uuid(),
    label: z.string().max(80).nullish(),
    // A aparência também volta: ausente (um "Desfazer" de antes de 0019) cai
    // no padrão do banco.
    tone: connectionStyleShape.tone.optional(),
    stroke: connectionStyleShape.stroke.optional(),
    weight: connectionStyleShape.weight.optional(),
    heads: connectionStyleShape.heads.optional(),
  })
  .refine((value) => value.fromWindowId !== value.toWindowId);

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

/* ---------------------------------------------------------------------- */
/* A borracha                                                              */
/* ---------------------------------------------------------------------- */

/**
 * Apagar janelas em lote.
 *
 * `ids` ausente significa **a lousa inteira** — é o "apagar tudo". Com
 * `ids`, é o que a borracha encostou durante um gesto: o cliente junta o
 * que passou por baixo do ponteiro e manda uma requisição só quando a
 * pessoa solta, no mesmo princípio do arraste.
 *
 * O teto do array é o teto absoluto por lousa: acima disso não existe
 * janela para apagar, e um array maior só serviria para fazer o servidor
 * montar uma cláusula `IN` gigante à toa.
 */
export const clearWindowsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(ABSOLUTE_WINDOWS_PER_BOARD).optional(),
});

/**
 * Desfazer uma apagada.
 *
 * O corpo é o que o `DELETE` devolveu — as linhas que saíram, com geometria,
 * conteúdo e **o id que elas tinham**.
 *
 * O id volta de propósito. Sem ele, desfazer devolveria janelas parecidas
 * com as de antes, mas novas — e as ligações entre elas, que apontam para
 * id, teriam se perdido no caminho. Aceitar a chave primária do cliente não
 * abre nada: a linha entra com o `user_id` do token e as mesmas chaves
 * estrangeiras de sempre, e um id já ocupado cai no `onConflictDoNothing`.
 * O pior que um cliente adulterado consegue é reservar um uuid na própria
 * lousa.
 *
 * `source` é a exceção que volta como veio. Quem escreveu a janela é
 * informação do produto (princípio nº 4: autoria da IA nunca some), e
 * restaurar tudo como "user" apagaria justamente isso. O campo é um enum de
 * dois valores: o pior que um cliente adulterado consegue é mentir sobre a
 * própria autoria na própria lousa.
 */
const restorableWindowSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["note", "sticky", "text", "attachment"]),
    source: z.enum(["user", "ai"]).default("user"),
    noteId: z.uuid().nullish(),
    attachmentId: z.uuid().nullish(),
    content: z
      .object({
        text: z.string().max(4000).optional(),
        tone: toneSchema.optional(),
        backgroundTone: backgroundToneSchema.optional(),
        textTone: textToneSchema.optional(),
        borderless: z.boolean().optional(),
      })
      .nullish(),
    x: coordinate,
    y: coordinate,
    width,
    height,
    zIndex: z.number().int().min(0).max(1_000_000),
    state: windowStateSchema,
  })
  .superRefine((value, ctx) => {
    // O mesmo pareamento do CHECK `workspace_windows_kind_matches_target`.
    // Aqui para o cliente receber um 400 com sentido; lá porque é onde a
    // garantia mora.
    if ((value.kind === "note") !== Boolean(value.noteId)) {
      ctx.addIssue({
        code: "custom",
        message: "Só a janela de nota aponta para uma nota.",
      });
    }
    if ((value.kind === "attachment") !== Boolean(value.attachmentId)) {
      ctx.addIssue({
        code: "custom",
        message: "Só a janela de anexo aponta para um anexo.",
      });
    }
  });

export const restoreWindowsSchema = z
  .object({
    // Sem mínimo: a borracha que encostou só numa flecha apaga uma linha de
    // ligação e nenhuma janela, e o Desfazer dela é um lote sem janelas.
    windows: z
      .array(restorableWindowSchema)
      .max(ABSOLUTE_WINDOWS_PER_BOARD)
      .optional(),
    // As flechas que sumiram junto com as janelas — por cascade, sem passar
    // por rota nenhuma. Voltam depois delas, e só as que ainda têm as duas
    // pontas de pé.
    connections: z
      .array(restorableConnectionSchema)
      .max(ABSOLUTE_CONNECTIONS_PER_BOARD)
      .optional(),
  })
  .refine(
    (value) =>
      (value.windows?.length ?? 0) > 0 || (value.connections?.length ?? 0) > 0,
    { message: "Nada para restaurar." }
  );

export type RestorableWindow = z.infer<typeof restorableWindowSchema>;
