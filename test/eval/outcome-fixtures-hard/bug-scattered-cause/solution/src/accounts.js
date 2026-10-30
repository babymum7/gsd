// The account store. Every address is kept trimmed and lower-cased, and every lookup
// normalizes its input the same way.
const accounts = [];

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function resetAccounts() {
  accounts.length = 0;
}

export function signUp(email, password) {
  const address = normalizeEmail(email);
  if (accounts.some((account) => account.email === address)) throw new Error("email already registered");
  const account = { email: address, password, resetToken: null };
  accounts.push(account);
  return account;
}

export function findAccount(email) {
  const address = normalizeEmail(email);
  return accounts.find((account) => account.email === address) ?? null;
}

export function listAccounts() {
  return accounts;
}
