import {
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  secret: string,
  salt: Buffer,
  length: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;

/** PIN (ou código de recuperação) guardado só como scrypt com sal próprio. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifySecret(
  secret: string,
  stored: string,
): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(
    secret,
    Buffer.from(salt, 'base64'),
    expected.length,
  );
  return timingSafeEqual(actual, expected);
}

/** Token da sessão: aleatório; no banco vai só o SHA-256. */
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Sem letras que se confundem (0/O, 1/I/L) para o dono anotar à mão. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Ex.: K7QM-2XRA-9PDF (60 bits). */
export function newRecoveryCode(): string {
  const chars = Array.from(
    { length: 12 },
    () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
  ).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/** Aceita minúsculas, espaços e sem os traços. */
export const normalizeRecoveryCode = (code: string) =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, '');
