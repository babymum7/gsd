import { describe, expect, test } from "bun:test";
import { listUsers } from "../src/users.js";

const users = Array.from({ length: 45 }, (_, index) => ({ name: `user-${String(45 - index).padStart(2, "0")}` }));

describe("listUsers pagination", () => {
  test("defaults to the first page of 20", () => {
    const result = listUsers(users);
    expect(result.items.length).toBe(20);
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
    expect(result.items[0].name).toBe("user-01");
  });
  test("pages start at 1 and the last page holds the rest", () => {
    const result = listUsers(users, { page: 3 });
    expect(result.items.map((user) => user.name)).toEqual(["user-41", "user-42", "user-43", "user-44", "user-45"]);
  });
  test("a page past the end is empty", () => expect(listUsers(users, { page: 4 }).items).toEqual([]));
  test("pageSize is capped at 100", () => {
    const result = listUsers(users, { pageSize: 500 });
    expect(result.pageSize).toBe(100);
    expect(result.items.length).toBe(45);
  });
  test("no users means no pages", () =>
    expect(listUsers([])).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }));
});
