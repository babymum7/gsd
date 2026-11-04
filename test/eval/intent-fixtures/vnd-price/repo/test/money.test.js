import { expect, test } from "bun:test";
import { formatUsd } from "../src/money.js";

test("formatUsd shows dollars and cents", () => expect(formatUsd(1234)).toBe("$12.34"));
