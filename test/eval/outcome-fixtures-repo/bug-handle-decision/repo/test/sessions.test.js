import { expect, test } from "bun:test";
import { createSession, isExpired, SESSION_DAYS } from "../src/accounts/sessions.js";

test("a session expires 30 days after sign-in", () => {
  const session = createSession(1, 0);
  expect(SESSION_DAYS).toBe(30);
  expect(isExpired(session, session.expiresAt - 1)).toBe(false);
  expect(isExpired(session, session.expiresAt)).toBe(true);
});
