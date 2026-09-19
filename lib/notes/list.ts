import type { FolderFilter } from "@/lib/folders/types";

export const NOTE_LIST_PAGE_SIZE = 18;

export const NOTE_TYPES = [
  "note",
  "task",
  "journal",
  "idea",
  "meeting",
  "document",
] as const;

export type NoteListType = (typeof NOTE_TYPES)[number];
export type NoteListSource = "all" | "user" | "ai";
export type NoteListSort = "updated" | "created" | "title";

export interface NoteListItem {
  id: string;
  title: string;
  excerpt: string | null;
  /**
   * O resumo da Nexo, só quando ele ainda descreve o texto atual. Resumo de
   * uma versão anterior não entra: a linha cai para o `excerpt`.
   */
  summary: string | null;
  type: string;
  source: string;
  workspaceName: string | null;
  /** A pasta da nota (0026), e quem a pôs lá. */
  folder: { id: string; name: string; source: "user" | "ai" } | null;
  updatedAt: Date | string;
  createdAt: Date | string;
  tags: { id: string; name: string; color: string | null }[];
}

export interface NoteListResult {
  notes: NoteListItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Conteúdo seguro para a leitura rápida no acervo, sem o documento do editor. */
export interface NotePreview {
  id: string;
  title: string;
  content: string | null;
  /** O resumo da Nexo, se houver — mesmo de uma versão anterior. */
  summary: string | null;
  /** O texto mudou depois do resumo. */
  summaryStale: boolean;
  type: string;
  source: string;
  workspaceName: string | null;
  folder: { id: string; name: string; source: "user" | "ai" } | null;
  updatedAt: Date | string;
}

export interface NoteListOptions {
  query?: string;
  source?: NoteListSource;
  type?: NoteListType | "all";
  sort?: NoteListSort;
  /** `all`, `none` (sem pasta) ou o id de uma pasta. */
  folder?: FolderFilter;
  page?: number;
  pageSize?: number;
}
