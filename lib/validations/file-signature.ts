/**
 * Validação de magic bytes: confere se os primeiros bytes do arquivo batem
 * com o MIME declarado. Cobre toda a whitelist de /api/attachments:
 *
 *   application/pdf  -> %PDF
 *   docx (OOXML)     -> PK\x03\x04 (container ZIP)
 *   audio/mpeg       -> ID3 ou frame sync FF FB/FA/F3
 *   audio/wav        -> RIFF....WAVE
 *   audio/mp4, x-m4a -> ....ftyp.... (ISO base media)
 *   image/jpeg       -> FF D8 FF
 *   image/png        -> \x89PNG\r\n\x1a\n
 *   image/webp       -> RIFF....WEBP
 *   image/gif        -> GIF87a / GIF89a
 *   text/plain, text/markdown -> sem assinatura, sempre passam
 */

// Maior assinatura da whitelist tem 12 bytes (RIFF + WAVE).
const SIGNATURE_BYTES = 12;

export async function readSignature(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index++) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function matchesSignature(
  mimeType: string,
  bytes: Uint8Array
): boolean {
  switch (mimeType) {
    case "application/pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]); // "%PDF"
    case DOCX_MIME:
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04" (ZIP)
    case "audio/mpeg":
      return (
        startsWith(bytes, [0x49, 0x44, 0x33]) || // "ID3"
        (bytes[0] === 0xff && [0xfb, 0xfa, 0xf3].includes(bytes[1] ?? 0))
      );
    case "audio/wav":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, "WAVE");
    case "audio/mp4":
    case "audio/x-m4a":
      return asciiAt(bytes, 4, "ftyp");
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, "WEBP");
    case "image/gif":
      return asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a");
    case "text/plain":
    case "text/markdown":
      // Texto puro não tem assinatura — nada a conferir.
      return true;
    default:
      // MIME fora da whitelist não deveria chegar aqui; por segurança, falha.
      return false;
  }
}
