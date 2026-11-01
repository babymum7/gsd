import { expect, test } from "bun:test";
import { sortByName } from "../src/users.js";

test("sortByName orders users by name", () =>
  expect(sortByName([{ name: "bo" }, { name: "an" }]).map((user) => user.name)).toEqual(["an", "bo"]));
