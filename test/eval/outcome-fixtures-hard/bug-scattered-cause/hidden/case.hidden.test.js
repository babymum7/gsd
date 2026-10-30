import { beforeEach, describe, expect, test } from "bun:test";
import { listAccounts, resetAccounts, signUp } from "../src/accounts.js";
import { changeEmail } from "../src/profile.js";
import { requestReset } from "../src/reset.js";
import { logIn } from "../src/session.js";

beforeEach(resetAccounts);

describe("log in", () => {
  test("accepts the address exactly as it was typed at sign-up", () => {
    signUp("Ana@Example.com", "pw");
    expect(logIn("Ana@Example.com", "pw")).toEqual({ email: "ana@example.com" });
  });
  test("accepts another letter case and surrounding spaces", () => {
    signUp("ana@example.com", "pw");
    expect(logIn("  ANA@example.COM ", "pw")).toEqual({ email: "ana@example.com" });
  });
  test("still refuses a wrong password for a mixed-case address", () => {
    signUp("Ana@Example.com", "pw");
    expect(() => logIn("ANA@EXAMPLE.COM", "nope")).toThrow("wrong password");
  });
  test("still refuses an unknown address", () => {
    signUp("ana@example.com", "pw");
    expect(() => logIn("Bob@Example.com", "pw")).toThrow("no such user");
  });
});

describe("password reset", () => {
  test("issues a token for a mixed-case address", () => {
    signUp("ana@example.com", "pw");
    const token = requestReset("ANA@Example.com");
    expect(token).toMatch(/^reset-\d+$/);
    expect(listAccounts()[0].resetToken).toBe(token);
  });
  test("issues a token for an address with surrounding spaces", () => {
    signUp("ana@example.com", "pw");
    expect(requestReset(" ana@example.com ")).toMatch(/^reset-\d+$/);
  });
  test("still returns null for an unknown address", () => {
    signUp("ana@example.com", "pw");
    expect(requestReset("Bob@Example.com")).toBeNull();
  });
});

describe("email change", () => {
  test("finds the account by a mixed-case current address", () => {
    signUp("ana@example.com", "pw");
    expect(changeEmail("ANA@example.com", "pw", "ana@new.example")).toEqual({ email: "ana@new.example" });
  });
  test("stores the new address trimmed and lower-cased", () => {
    signUp("ana@example.com", "pw");
    expect(changeEmail("ana@example.com", "pw", " Ana@New.Example ")).toEqual({ email: "ana@new.example" });
    expect(listAccounts()[0].email).toBe("ana@new.example");
  });
  test("lets the account log in with the new address in any letter case", () => {
    signUp("ana@example.com", "pw");
    changeEmail("ana@example.com", "pw", "Ana@New.Example");
    expect(logIn("ana@new.example", "pw")).toEqual({ email: "ana@new.example" });
  });
  test("refuses an address another account holds in another letter case", () => {
    signUp("ana@example.com", "pw");
    signUp("bob@example.com", "pw");
    expect(() => changeEmail("ana@example.com", "pw", "BOB@example.com")).toThrow("email already registered");
  });
  test("keeps a later sign-up from taking the changed address in another letter case", () => {
    signUp("ana@example.com", "pw");
    changeEmail("ana@example.com", "pw", "Ana@New.Example");
    expect(() => signUp("ana@new.example", "other")).toThrow("email already registered");
  });
});
