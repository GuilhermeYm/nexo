/**
 * A cor de uma tag.
 *
 * `tags.color` nasce nulo: até aqui só a classificação por IA criava tags, e
 * ela não escolhe cor. Em vez de deixar tudo cinza, deriva-se uma das seis
 * matizes da paleta do tema (`tag-1`..`tag-6` do `globals.css`) do próprio
 * nome — a mesma tag cai sempre na mesma cor, e nada precisa ir ao banco.
 *
 * As tags criadas na lousa (`POST /api/notes/[id]/tags`) **gravam** essa cor,
 * então elas aparecem coloridas em todo lugar; as antigas, sem cor, só ganham
 * a cor derivada onde `tagTone` é usado — hoje, a página `/dashboard/tags`.
 */

export const TAG_PALETTE = ["1", "2", "3", "4", "5", "6"] as const;
export type TagPalette = (typeof TAG_PALETTE)[number];

/**
 * FNV-1a de 32 bits: estável entre runtimes, sem depender de `crypto`, e bom
 * o bastante para espalhar nomes pelas seis posições.
 */
export function paletteFromName(name: string): TagPalette {
  const normalized = name.trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return TAG_PALETTE[(hash >>> 0) % TAG_PALETTE.length];
}

/** A posição na paleta de uma tag: a gravada, quando válida; senão a do nome. */
export function tagTone(tag: {
  name: string;
  color: string | null;
}): TagPalette {
  return (TAG_PALETTE as readonly string[]).includes(tag.color ?? "")
    ? (tag.color as TagPalette)
    : paletteFromName(tag.name);
}

/** Classe do chip (superfície + texto da mesma matiz), por posição. */
export const TAG_CHIP_CLASS: Record<TagPalette, string> = {
  "1": "bg-tag-1 text-tag-1-foreground",
  "2": "bg-tag-2 text-tag-2-foreground",
  "3": "bg-tag-3 text-tag-3-foreground",
  "4": "bg-tag-4 text-tag-4-foreground",
  "5": "bg-tag-5 text-tag-5-foreground",
  "6": "bg-tag-6 text-tag-6-foreground",
};

/** Classe da bolinha de cor, por posição. */
export const TAG_DOT_CLASS: Record<TagPalette, string> = {
  "1": "bg-tag-1-foreground",
  "2": "bg-tag-2-foreground",
  "3": "bg-tag-3-foreground",
  "4": "bg-tag-4-foreground",
  "5": "bg-tag-5-foreground",
  "6": "bg-tag-6-foreground",
};

/**
 * Classe do chip pela cor **gravada**, sem derivar do nome — cinza neutro
 * quando não há. É o que a lousa e o "Trazer da conta" usam: a cor derivada
 * mora só na página `/dashboard/tags`.
 */
export function storedChipClass(tag: { color: string | null }): string {
  return (TAG_PALETTE as readonly string[]).includes(tag.color ?? "")
    ? TAG_CHIP_CLASS[tag.color as TagPalette]
    : "bg-secondary text-muted-foreground";
}
