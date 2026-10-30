import { beforeEach, expect, test } from "bun:test";
import { listAccounts, resetAccounts, signUp } from "../src/accounts.js";
import { changeEmail } from "../src/profile.js";
import { requestReset } from "../src/reset.js";
import { logIn } from "../src/session.js";

beforeEach(resetAccounts);

test("a new account logs in", () => {
  signUp("ana@example.com", "pw");
  expect(logIn("ana@example.com", "pw")).toEqual({ email: "ana@example.com" });
});

test("a wrong password is refused", () => {
  signUp("ana@example.com", "pw");
  expect(() => logIn("ana@example.com", "nope")).toThrow("wrong password");
});

test("an unknown address is refused", () => {
  expect(() => logIn("nobody@example.com", "pw")).toThrow("no such user");
});

test("an address signs up only once", () => {
  signUp("ana@example.com", "pw");
  expect(() => signUp("ana@example.com", "other")).toThrow("email already registered");
});

test("a reset issues a token for a known address and null otherwise", () => {
  signUp("ana@example.com", "pw");
  const token = requestReset("ana@example.com");
  expect(token).toMatch(/^reset-\d+$/);
  expect(listAccounts()[0].resetToken).toBe(token);
  expect(requestReset("nobody@example.com")).toBeNull();
});

test("an account changes its address and logs in with the new one", () => {
  signUp("ana@example.com", "pw");
  expect(changeEmail("ana@example.com", "pw", "ana@new.example")).toEqual({ email: "ana@new.example" });
  expect(logIn("ana@new.example", "pw")).toEqual({ email: "ana@new.example" });
});

test("a change needs the right password", () => {
  signUp("ana@example.com", "pw");
  expect(() => changeEmail("ana@example.com", "nope", "ana@new.example")).toThrow("not authorized");
});
