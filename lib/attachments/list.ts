export const ATTACHMENT_LIST_PAGE_SIZE = 24;

export const ATTACHMENT_TYPES = [
  "image",
  "audio",
  "video",
  "pdf",
  "document",
  "other",
] as const;

export type AttachmentListType = (typeof ATTACHMENT_TYPES)[number];
export type AttachmentListSort = "newest" | "name" | "size";

/** Metadados seguros para o acervo: o caminho interno do Storage não sai daqui. */
export interface AttachmentListItem {
  id: string;
  filename: string;
  mimeType: string;
  type: AttachmentListType;
  sizeBytes: number | null;
  durationSeconds: number | null;
  createdAt: Date | string;
  note: { id: string; title: string } | null;
}

export interface AttachmentListResult {
  attachments: AttachmentListItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AttachmentListOptions {
  query?: string;
  type?: AttachmentListType | "all";
  sort?: AttachmentListSort;
  page?: number;
  pageSize?: number;
}
