export const PNG_SIGNATURE = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
] as const;

export function isPngBuffer(buffer: Buffer): boolean {
  if (buffer.length < PNG_SIGNATURE.length) {
    return false;
  }

  return PNG_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

export function isPngHeader(header: Buffer): boolean {
  return isPngBuffer(header);
}
