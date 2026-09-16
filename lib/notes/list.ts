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
  type: string;
  source: string;
  workspaceName: string | null;
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

export interface NoteListOptions {
  query?: string;
  source?: NoteListSource;
  type?: NoteListType | "all";
  sort?: NoteListSort;
  page?: number;
  pageSize?: number;
}
