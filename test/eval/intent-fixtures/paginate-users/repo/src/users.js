export function sortByName(users) {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}

export function listUsers(users) {
  return sortByName(users);
}
