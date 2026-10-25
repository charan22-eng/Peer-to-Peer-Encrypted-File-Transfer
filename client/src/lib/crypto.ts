import { createSHA256 } from 'hash-wasm';

export async function computeHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintPublicKeys(localKey: JsonWebKey, remoteKey: JsonWebKey): Promise<string> {
  const keys = [localKey, remoteKey]
    .map(key => JSON.stringify({ kty: key.kty, crv: key.crv, x: key.x, y: key.y }))
    .sort()
    .join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keys));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return hex.match(/.{1,4}/g)?.slice(0, 8).join('-').toUpperCase() || hex.toUpperCase();
}

export async function hashFileStream(file: File, onProgress?: (progress: number) => void): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();

  const chunkSize = 4 * 1024 * 1024; // 4MB chunks to prevent event loop starvation
  let offset = 0;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    const buffer = await chunk.arrayBuffer();
    hasher.update(new Uint8Array(buffer));
    offset += chunk.size;
    if (onProgress) {
      onProgress(Math.min(offset / file.size, 1));
    }
    // Yield to event loop to allow WebRTC ICE keepalives to process
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return hasher.digest('hex');
}

export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
  return await crypto.subtle.exportKey('jwk', key);
}

export async function deriveAESKey(privateKey: CryptoKey, publicKeyData: JsonWebKey): Promise<CryptoKey> {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyData,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  return await crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptChunk(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  
  const payload = new Uint8Array(12 + encrypted.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(encrypted), 12);
  
  return payload.buffer;
}

export async function decryptChunk(key: CryptoKey, payloadData: ArrayBuffer): Promise<ArrayBuffer> {
  const payload = new Uint8Array(payloadData);
  const iv = payload.slice(0, 12);
  const encrypted = payload.slice(12);
  
  return await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );
}
