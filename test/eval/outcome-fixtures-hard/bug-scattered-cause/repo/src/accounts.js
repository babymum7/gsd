// The account store. Every address is kept trimmed and lower-cased.
const accounts = [];

export function resetAccounts() {
  accounts.length = 0;
}

export function signUp(email, password) {
  const address = email.trim().toLowerCase();
  if (accounts.some((account) => account.email === address)) throw new Error("email already registered");
  const account = { email: address, password, resetToken: null };
  accounts.push(account);
  return account;
}

export function findAccount(email) {
  return accounts.find((account) => account.email === email) ?? null;
}

export function listAccounts() {
  return accounts;
}
