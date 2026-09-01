interface DigestProvider {
  subtle: {
    digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Stable command UUID for one exact ordered payload. A response lost after the
 * database commit can therefore be replayed after a refresh without creating
 * a second command. PostgreSQL also checks the payload hash for the same key.
 */
export async function createCollectionImportCommandKey(
  payload: unknown,
  provider: DigestProvider | null = globalThis.crypto,
): Promise<string> {
  if (!provider?.subtle || typeof provider.subtle.digest !== 'function') {
    throw new Error('Générateur de commande sécurisé indisponible — promotion Collection refusée.');
  }

  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const digest = new Uint8Array(await provider.subtle.digest('SHA-256', encoded));
  const uuidBytes = digest.slice(0, 16);
  // UUID v8 (custom) + RFC 4122 variant; deterministic SHA-256 payload key.
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x80;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const value = hex(uuidBytes);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
