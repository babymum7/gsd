import { findAccount, listAccounts } from "./accounts.js";

export function changeEmail(currentEmail, password, newEmail) {
  const account = findAccount(currentEmail);
  if (!account || account.password !== password) throw new Error("not authorized");
  if (listAccounts().some((other) => other.email === newEmail)) throw new Error("email already registered");
  account.email = newEmail;
  return { email: account.email };
}
