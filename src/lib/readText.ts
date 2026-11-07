export async function readTextSmart(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gbk').decode(bytes);
  }
}

export function decodeZipName(bytes: unknown): string {
  const raw = toBytes(bytes);
  if (!raw.length) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder('gbk').decode(raw);
  }
}

function toBytes(bytes: unknown): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  if (typeof bytes === 'string') return Uint8Array.from(bytes, (char) => char.charCodeAt(0) & 0xff);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes, (value) => Number(value) & 0xff);
  return new Uint8Array();
}
