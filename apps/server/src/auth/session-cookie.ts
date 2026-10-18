import type { Response } from 'express';
import { loadEnv } from '../config/env';

export const SESSION_COOKIE = 'crm_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function cookieOptions() {
  return {
    httpOnly: true, // not readable from JavaScript, so XSS can't steal it
    sameSite: 'lax' as const, // not sent on cross-site POSTs (CSRF protection)
    secure: loadEnv().APP_URL.startsWith('https://'),
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_SECONDS * 1000 });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}
