const users = [];

export function resetUsers() {
  users.length = 0;
}

export function register(handle) {
  const typed = handle.trim();
  if (users.some((user) => user.handle === typed)) throw new Error(`handle taken: ${typed}`);
  const user = { id: users.length + 1, handle: typed };
  users.push(user);
  return user;
}

export function findByHandle(handle) {
  return users.find((user) => user.handle === handle.trim()) ?? null;
}

export function displayName(id) {
  const user = users.find((entry) => entry.id === id);
  if (!user) throw new Error(`no such user: ${id}`);
  return `@${user.handle}`;
}
