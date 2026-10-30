import { describe, expect, test } from "bun:test";
import { renderReport } from "../src/report.js";

describe("renderReport", () => {
  test("renders a block per team with its rows and a total", () => {
    const text = "ann,dev,8\nbob,dev,6.5\ncy,ops,4\n";
    expect(renderReport(text)).toBe(
      [
        "dev",
        "  ann    8.00",
        "  bob    6.50",
        "  Total  14.50",
        "",
        "ops",
        "  cy     4.00",
        "  Total  4.00",
      ].join("\n"),
    );
  });

  test("lists teams by name and each team's busiest rows first", () => {
    const text = ["bob,ops,3", "dee,qa,2.25", "ann,dev,5", "cy,ops,7.5", "eli,dev,4"].join("\n");
    expect(renderReport(text)).toBe(
      [
        "dev",
        "  ann    5.00",
        "  eli    4.00",
        "  Total  9.00",
        "",
        "ops",
        "  cy     7.50",
        "  bob    3.00",
        "  Total  10.50",
        "",
        "qa",
        "  dee    2.25",
        "  Total  2.25",
      ].join("\n"),
    );
  });
});
