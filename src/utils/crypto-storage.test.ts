import { describe, it, expect } from 'vitest';
import { generateKey, encryptValue, decryptValue, isEncrypted } from './crypto-storage';

describe('crypto-storage', () => {
  it('round-trips encrypt then decrypt', async () => {
    const key = await generateKey();
    const plaintext = 'sk-ant-api03-secret-key-value';
    const encrypted = await encryptValue(key, plaintext);
    const decrypted = await decryptValue(key, encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const key = await generateKey();
    const plaintext = 'AIzaSy-some-gemini-key';
    const enc1 = await encryptValue(key, plaintext);
    const enc2 = await encryptValue(key, plaintext);
    expect(enc1).not.toBe(enc2);
    // But both decrypt to the same value
    expect(await decryptValue(key, enc1)).toBe(plaintext);
    expect(await decryptValue(key, enc2)).toBe(plaintext);
  });

  it('returns empty string for empty plaintext', async () => {
    const key = await generateKey();
    const encrypted = await encryptValue(key, '');
    expect(encrypted).toBe('');
    const decrypted = await decryptValue(key, '');
    expect(decrypted).toBe('');
  });

  it('returns null when decrypting with the wrong key', async () => {
    const key1 = await generateKey();
    const key2 = await generateKey();
    const encrypted = await encryptValue(key1, 'secret-data');
    const result = await decryptValue(key2, encrypted);
    expect(result).toBeNull();
  });

  it('isEncrypted detects enc:v1: prefix', () => {
    expect(isEncrypted('enc:v1:abcdef1234:9876543210')).toBe(true);
    expect(isEncrypted('enc:v1:')).toBe(true);
  });

  it('isEncrypted does NOT false-positive on plaintext API keys or raw hex', () => {
    expect(isEncrypted('sk-ant-api03-abcdef')).toBe(false);
    expect(isEncrypted('AIzaSyD-abcdef12345')).toBe(false);
    expect(isEncrypted('abcdef1234567890abcdef')).toBe(false);
    expect(isEncrypted('{"gemini":"AIza..."}')).toBe(false);
    expect(isEncrypted('')).toBe(false);
  });

  it('decryptValue returns null for non-encrypted input', async () => {
    const key = await generateKey();
    const result = await decryptValue(key, 'not-encrypted-value');
    expect(result).toBeNull();
  });

  it('decryptValue returns null for corrupted ciphertext', async () => {
    const key = await generateKey();
    const result = await decryptValue(key, 'enc:v1:baddata');
    expect(result).toBeNull();
  });
});
