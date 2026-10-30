import { beforeEach, describe, expect, test } from "bun:test";
import { renderMentions } from "../src/messaging/mentions.js";
import { displayName, findByHandle, register, resetUsers } from "../src/accounts/users.js";

beforeEach(resetUsers);

describe("users", () => {
  test("register hands out sequential ids", () => {
    expect(register("ana").id).toBe(1);
    expect(register("bob").id).toBe(2);
  });
  test("register refuses a handle that is already taken", () => {
    register("ana");
    expect(() => register("ana")).toThrow("handle taken");
  });
  test("displayName shows the handle with an @", () => {
    register("bob");
    expect(displayName(1)).toBe("@bob");
  });
  test("findByHandle returns null for an unknown handle", () => {
    expect(findByHandle("zed")).toBeNull();
  });
});

describe("mentions", () => {
  test("links a known handle to its profile", () => {
    register("ana");
    expect(renderMentions("hi @ana")).toBe("hi [@ana](/u/1)");
  });
  test("leaves an unknown handle as typed", () => {
    expect(renderMentions("hi @zed")).toBe("hi @zed");
  });
});
