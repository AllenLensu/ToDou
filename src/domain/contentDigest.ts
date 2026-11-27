/** Backups and sync files use the same SHA-256 names on every origin. */
export async function sha256Hex(content: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  const hash = crypto.subtle
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    : (await import('@noble/hashes/sha2.js')).sha256(bytes)
  return Array.from(hash, value => value.toString(16).padStart(2, '0')).join('')
}
