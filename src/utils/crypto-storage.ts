const ALGORITHM = 'AES-GCM';
const VERSION_PREFIX = 'enc:v1:';
const KEY_DB_NAME = 'mas-keystore';
const KEY_DB_STORE = 'keys';
const KEY_DB_KEY = 'api-key-encryption';

export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt'],
  );
}

export async function encryptValue(key: CryptoKey, plaintext: string): Promise<string> {
  if (!plaintext) return '';
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded,
  );
  const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join('');
  const ctHex = Array.from(new Uint8Array(ciphertext)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${VERSION_PREFIX}${ivHex}:${ctHex}`;
}

export async function decryptValue(key: CryptoKey, encrypted: string): Promise<string | null> {
  if (!encrypted) return '';
  if (!isEncrypted(encrypted)) return null;
  try {
    const payload = encrypted.slice(VERSION_PREFIX.length);
    const [ivHex, ctHex] = payload.split(':');
    if (!ivHex || !ctHex) return null;
    const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const ciphertext = new Uint8Array(ctHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/** Unambiguous prefix-based detection — no fragile regex on payload format. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(VERSION_PREFIX);
}

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(KEY_DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getOrCreateKey(): Promise<CryptoKey> {
  const db = await openKeyDB();
  const tx = db.transaction(KEY_DB_STORE, 'readonly');
  const store = tx.objectStore(KEY_DB_STORE);

  const existing = await new Promise<CryptoKey | undefined>((resolve) => {
    const req = store.get(KEY_DB_KEY);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => resolve(undefined);
  });

  if (existing) {
    db.close();
    return existing;
  }

  const key = await generateKey();
  const wtx = db.transaction(KEY_DB_STORE, 'readwrite');
  const wstore = wtx.objectStore(KEY_DB_STORE);
  await new Promise<void>((resolve, reject) => {
    const req = wstore.put(key, KEY_DB_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  db.close();
  return key;
}
