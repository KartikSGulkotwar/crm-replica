import * as bcrypt from 'bcrypt';
import { loadEnv } from '../config/env';

// Cheap hashing in tests keeps the suite fast; real cost everywhere else.
const rounds = () => (loadEnv().NODE_ENV === 'test' ? 4 : 12);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, rounds());
}

let dummyHash: Promise<string> | undefined;

/**
 * Compares a password with a stored hash. With no hash (unknown email) it still runs a
 * comparison, so response time doesn't reveal which emails have accounts.
 */
export async function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  if (hash) return bcrypt.compare(password, hash);
  dummyHash ??= bcrypt.hash('not-a-real-password', rounds());
  await bcrypt.compare(password, await dummyHash);
  return false;
}
