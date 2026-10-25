import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_MAX_DAYS = 90;

export function hashSecret(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

// A new key `iomp_<prefix>_<secret>`. Only `prefix` and `secretSha256` are stored; the key is
// shown once.
export function generateApiKey(): { key: string; prefix: string; secretSha256: Buffer } {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { key: `iomp_${prefix}_${secret}`, prefix, secretSha256: hashSecret(secret) };
}
