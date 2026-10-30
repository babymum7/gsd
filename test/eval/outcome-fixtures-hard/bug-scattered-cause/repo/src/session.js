import { findAccount } from "./accounts.js";

export function logIn(email, password) {
  const account = findAccount(email);
  if (!account) throw new Error("no such user");
  if (account.password !== password) throw new Error("wrong password");
  return { email: account.email };
}
