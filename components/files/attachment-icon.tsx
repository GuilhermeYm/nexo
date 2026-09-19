import {
  File,
  FileAudio,
  FileText,
  FileType2,
  ImageIcon,
  Music2,
  Video,
} from "lucide-react";

import type { AttachmentListType } from "@/lib/attachments/list";

/** O nome de um arquivo daquele formato, no singular. */
export const ATTACHMENT_TYPE_NAME: Record<AttachmentListType, string> = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  pdf: "PDF",
  document: "Documento",
  other: "Arquivo",
};

/** Um componente, e não uma função que devolve o ícone: o React exige que
 *  componentes existam fora do render. */
export function AttachmentIcon({
  type,
  className,
}: {
  type: AttachmentListType;
  className?: string;
}) {
  const props = { className, "aria-hidden": true } as const;
  switch (type) {
    case "audio":
      return <Music2 {...props} />;
    case "document":
      return <FileText {...props} />;
    case "image":
      return <ImageIcon {...props} />;
    case "pdf":
      return <FileType2 {...props} />;
    case "video":
      return <Video {...props} />;
    case "other":
      return <File {...props} />;
    default:
      return <FileAudio {...props} />;
  }
}
