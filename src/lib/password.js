// Password hashing with PBKDF2-SHA256 (WebCrypto). Only the salted hash is
// stored; there is no way to recover the password.

const ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 8;

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return { salt: toHex(salt), hash: toHex(hash), iterations };
}

export async function verifyPassword(password, record) {
  if (!record || typeof password !== 'string') return false;
  const hash = await derive(password, fromHex(record.salt), record.iterations);
  const expected = fromHex(record.hash);
  let diff = hash.length ^ expected.length;
  for (let i = 0; i < Math.min(hash.length, expected.length); i++) diff |= hash[i] ^ expected[i];
  return diff === 0;
}
