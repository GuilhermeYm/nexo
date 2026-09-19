import { z } from "zod";

/**
 * O contrato das pastas que o navegador vê. Sem dependência de servidor —
 * `lib/folders/queries.ts` é quem fala com o banco.
 */

export const FOLDER_NAME_MAX = 60;
/** Teto por conta: pasta demais é o mesmo que nenhuma. */
export const MAX_FOLDERS_PER_USER = 60;

export interface FolderItem {
  id: string;
  name: string;
  /** Quem criou: a pessoa ou a organização da IA. */
  source: "user" | "ai";
  /** Notas ativas dentro dela. */
  noteCount: number;
}

/** O filtro de pasta em Notas: todas, sem pasta, ou uma pasta. */
export type FolderFilter = "all" | "none" | string;

/** O nome como a pessoa o escreveu, sem espaço sobrando. */
export function cleanFolderName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Para comparar: "Trabalho", "trabalho " e "Trabálho" são a mesma pasta. */
export function folderKey(value: string): string {
  return cleanFolderName(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export const folderNameSchema = z
  .string()
  .transform(cleanFolderName)
  .pipe(
    z
      .string()
      .min(1, "Dê um nome à pasta.")
      .max(FOLDER_NAME_MAX, `No máximo ${FOLDER_NAME_MAX} caracteres.`)
      .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Nome inválido.")
  );
