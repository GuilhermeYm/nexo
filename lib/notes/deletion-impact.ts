export interface NoteDeletionTagImpact {
  id: string;
  name: string;
  color: string | null;
  otherNoteCount: number;
  otherNotes: Array<{ id: string; title: string }>;
}

export interface NoteDeletionImpact {
  attachmentCount: number;
  tags: NoteDeletionTagImpact[];
}
