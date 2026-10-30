// A session lasts 30 days from sign-in (decision 0002).
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function createSession(userId, now) {
  return { userId, startedAt: now, expiresAt: now + SESSION_DAYS * DAY_MS };
}

export function isExpired(session, now) {
  return now >= session.expiresAt;
}
