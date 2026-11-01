const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export function sortByName(users) {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}

export function listUsers(users, { page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const size = Math.min(pageSize, MAX_PAGE_SIZE);
  const sorted = sortByName(users);
  const start = (page - 1) * size;
  return {
    items: sorted.slice(start, start + size),
    page,
    pageSize: size,
    total: sorted.length,
    totalPages: Math.ceil(sorted.length / size),
  };
}
