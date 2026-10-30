import { findAccount, normalizeEmail } from "./accounts.js";

export function changeEmail(currentEmail, password, newEmail) {
  const account = findAccount(currentEmail);
  if (!account || account.password !== password) throw new Error("not authorized");
  if (findAccount(newEmail)) throw new Error("email already registered");
  account.email = normalizeEmail(newEmail);
  return { email: account.email };
}
