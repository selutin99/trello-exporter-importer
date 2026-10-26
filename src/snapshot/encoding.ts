/**
 * Computes the digest of a local JSON input
 * @param bytes - Bytes to hash
 * @returns Lowercase SHA-256 hexadecimal digest
 */
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Encodes portable JSON as UTF-8 without embedding file bytes
 * @param value - Serializable snapshot
 * @returns UTF-8 JSON bytes
 */
export function jsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}
