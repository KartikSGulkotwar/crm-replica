import { randomBytes } from 'node:crypto';

/** 24 random bytes → 32 URL-safe characters. */
export const newInviteToken = () => randomBytes(24).toString('base64url');

export const isWellFormedInviteToken = (token: string) => /^[A-Za-z0-9_-]{32}$/.test(token);
