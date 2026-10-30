import { listAccounts } from "./accounts.js";

let issued = 0;

// Starts a password reset. An unknown address gets null, so a caller cannot tell which
// addresses have accounts.
export function requestReset(email) {
  const account = listAccounts().find((candidate) => candidate.email === email);
  if (!account) return null;
  issued += 1;
  account.resetToken = `reset-${issued}`;
  return account.resetToken;
}
