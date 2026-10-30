import { beforeEach, describe, expect, test } from "bun:test";
import { renderMentions } from "../src/messaging/mentions.js";
import { displayName, findByHandle, register, resetUsers } from "../src/accounts/users.js";

beforeEach(resetUsers);

describe("taken handles", () => {
  test("a handle differing only in letter case is taken", () => {
    register("Ana");
    expect(() => register("ana")).toThrow("handle taken");
  });
  test("a handle differing in case and surrounding spaces is taken", () => {
    register("ana");
    expect(() => register("  ANA ")).toThrow("handle taken");
  });
  test("handles that differ in more than case stay distinct", () => {
    register("Ana");
    expect(register("Anna").id).toBe(2);
  });
});

describe("stored case", () => {
  test("register keeps the case that was typed", () => {
    expect(register(" Ana ").handle).toBe("Ana");
  });
  test("displayName shows the handle as it was typed at sign-up", () => {
    register("McKenzie");
    expect(displayName(1)).toBe("@McKenzie");
  });
  test("a refused registration leaves the first spelling in place", () => {
    register("Ana");
    expect(() => register("ANA")).toThrow("handle taken");
    expect(displayName(1)).toBe("@Ana");
  });
});

describe("lookup and mentions", () => {
  test("findByHandle ignores letter case", () => {
    const ana = register("Ana");
    expect(findByHandle("ANA")).toEqual(ana);
  });
  test("findByHandle ignores case and surrounding spaces together", () => {
    const ana = register("Ana");
    expect(findByHandle(" aNa ")).toEqual(ana);
  });
  test("a mention typed in another case links to the user", () => {
    register("Ana");
    expect(renderMentions("hi @ana")).toBe("hi [@Ana](/u/1)");
  });
  test("every mention renders with the stored handle", () => {
    register("Ana");
    register("BoB");
    expect(renderMentions("@ANA meet @bob")).toBe("[@Ana](/u/1) meet [@BoB](/u/2)");
  });
});
