import { describe, expect, test } from "bun:test";
import * as report from "../src/report.js";

describe("renderReport on edge input", () => {
  test("skips a header line", () => {
    const text = "name,team,hours\nann,dev,8\nbob,dev,6\n";
    expect(report.renderReport(text)).toBe(
      ["dev", "  ann    8.00", "  bob    6.00", "  Total  14.00"].join("\n"),
    );
  });

  test("skips blank and whitespace-only lines", () => {
    const text = "\nann,dev,8\n\n   \n\t\nbob,dev,2.5\n";
    expect(report.renderReport(text)).toBe(
      ["dev", "  ann    8.00", "  bob    2.50", "  Total  10.50"].join("\n"),
    );
  });

  test("trims every field and groups on the trimmed team", () => {
    const text = "  ann , dev ,  8 \nbob,dev,6\n cy ,ops, 2.5";
    expect(report.renderReport(text)).toBe(
      [
        "dev",
        "  ann    8.00",
        "  bob    6.00",
        "  Total  14.00",
        "",
        "ops",
        "  cy     2.50",
        "  Total  2.50",
      ].join("\n"),
    );
  });

  test("skips rows with fewer than three fields", () => {
    const text = "ann,dev\nbob\nbob,dev,6\ncy,ops\n";
    expect(report.renderReport(text)).toBe(["dev", "  bob    6.00", "  Total  6.00"].join("\n"));
  });

  test("reads only the first three fields of a longer row", () => {
    const text = "ann,dev,8,remote,late\nbob,dev,6\n";
    expect(report.renderReport(text)).toBe(
      ["dev", "  ann    8.00", "  bob    6.00", "  Total  14.00"].join("\n"),
    );
  });

  test("skips rows with an empty name or team", () => {
    const text = ",dev,5\nann,,6\n  ,dev,7\nbob,dev,4\n";
    expect(report.renderReport(text)).toBe(["dev", "  bob    4.00", "  Total  4.00"].join("\n"));
  });

  test("skips rows whose hours are not a number", () => {
    const text = "ann,dev,n/a\nbob,dev,\ncy,dev,8h\ndee,dev,abc\neli,dev,6\n";
    expect(report.renderReport(text)).toBe(["dev", "  eli    6.00", "  Total  6.00"].join("\n"));
  });

  test("skips hours that are negative, lack a leading digit, or use an exponent", () => {
    const text = "ann,dev,-2\nbob,dev,.5\ncy,dev,1e3\neli,dev,3\n";
    expect(report.renderReport(text)).toBe(["dev", "  eli    3.00", "  Total  3.00"].join("\n"));
  });

  test("keeps a row with zero hours", () => {
    const text = "ann,dev,0\nbob,dev,3\n";
    expect(report.renderReport(text)).toBe(
      ["dev", "  bob    3.00", "  ann    0.00", "  Total  3.00"].join("\n"),
    );
  });

  test("sorts teams by name with capitals before lowercase", () => {
    const text = "ann,dev,5\nbob,Ops,3\ncy,QA,2\n";
    expect(report.renderReport(text)).toBe(
      [
        "Ops",
        "  bob    3.00",
        "  Total  3.00",
        "",
        "QA",
        "  cy     2.00",
        "  Total  2.00",
        "",
        "dev",
        "  ann    5.00",
        "  Total  5.00",
      ].join("\n"),
    );
  });

  test("sorts rows by hours, highest first, and keeps ties in input order", () => {
    const text = "zed,dev,5\namy,dev,5\nbob,dev,7\ncy,dev,5\ndee,dev,0.5\n";
    expect(report.renderReport(text)).toBe(
      [
        "dev",
        "  bob    7.00",
        "  zed    5.00",
        "  amy    5.00",
        "  cy     5.00",
        "  dee    0.50",
        "  Total  22.50",
      ].join("\n"),
    );
  });

  test("ends each team with the sum of its hours", () => {
    const text = "ann,dev,8\nbob,dev,6.5\ncy,dev,0.25\ndee,ops,4.75\neli,ops,1.5\n";
    expect(report.renderReport(text)).toBe(
      [
        "dev",
        "  ann    8.00",
        "  bob    6.50",
        "  cy     0.25",
        "  Total  14.75",
        "",
        "ops",
        "  dee    4.75",
        "  eli    1.50",
        "  Total  6.25",
      ].join("\n"),
    );
  });

  test("pads every name to the longest name across all teams", () => {
    const text = "alexandra,dev,8\nbo,ops,6\ncy,ops,2\n";
    expect(report.renderReport(text)).toBe(
      [
        "dev",
        "  alexandra  8.00",
        "  Total      8.00",
        "",
        "ops",
        "  bo         6.00",
        "  cy         2.00",
        "  Total      8.00",
      ].join("\n"),
    );
  });

  test("returns No data for empty or blank text", () => {
    expect(report.renderReport("")).toBe("No data");
    expect(report.renderReport("\n\n  \n")).toBe("No data");
  });

  test("returns No data when only a header or invalid rows remain", () => {
    expect(report.renderReport("name,team,hours\n")).toBe("No data");
    expect(report.renderReport("ann,dev\nbob,dev,n/a\n,dev,3\n")).toBe("No data");
  });

  test("reads CRLF line endings like LF", () => {
    const text = "name,team,hours\r\nann,dev,8\r\nbob,dev,6\r\n";
    expect(report.renderReport(text)).toBe(
      ["dev", "  ann    8.00", "  bob    6.00", "  Total  14.00"].join("\n"),
    );
  });
});

describe("parseRows", () => {
  test("returns each valid row with trimmed text and numeric hours, in input order", () => {
    const text =
      "name,team,hours\n bob , ops , 6.5 \n\nann,dev,8\nbad,row\ncy,dev,n/a\ndee,ops,0\n";
    expect(report.parseRows(text)).toEqual([
      { name: "bob", team: "ops", hours: 6.5 },
      { name: "ann", team: "dev", hours: 8 },
      { name: "dee", team: "ops", hours: 0 },
    ]);
  });

  test("returns an empty array when no row is valid", () => {
    expect(report.parseRows("")).toEqual([]);
    expect(report.parseRows("name,team,hours\nann,dev\n")).toEqual([]);
  });
});

describe("groupByTeam", () => {
  test("groups rows by team, sorted by team name, with each team's total", () => {
    const rows = [
      { name: "cy", team: "ops", hours: 4 },
      { name: "ann", team: "dev", hours: 5 },
      { name: "bob", team: "ops", hours: 7.5 },
      { name: "dee", team: "dev", hours: 0.25 },
      { name: "eli", team: "qa", hours: 2.25 },
    ];
    expect(report.groupByTeam(rows)).toEqual([
      {
        team: "dev",
        rows: [
          { name: "ann", team: "dev", hours: 5 },
          { name: "dee", team: "dev", hours: 0.25 },
        ],
        total: 5.25,
      },
      {
        team: "ops",
        rows: [
          { name: "bob", team: "ops", hours: 7.5 },
          { name: "cy", team: "ops", hours: 4 },
        ],
        total: 11.5,
      },
      { team: "qa", rows: [{ name: "eli", team: "qa", hours: 2.25 }], total: 2.25 },
    ]);
  });

  test("sorts a team's rows by hours, highest first, with ties in input order", () => {
    const rows = [
      { name: "zed", team: "dev", hours: 5 },
      { name: "amy", team: "dev", hours: 5 },
      { name: "bob", team: "dev", hours: 7 },
      { name: "cy", team: "dev", hours: 5 },
      { name: "dee", team: "dev", hours: 0.5 },
    ];
    const [group] = report.groupByTeam(rows);
    expect(group.rows.map((row) => row.name)).toEqual(["bob", "zed", "amy", "cy", "dee"]);
    expect(group.total).toBe(22.5);
  });

  test("returns an empty array for no rows", () => {
    expect(report.groupByTeam([])).toEqual([]);
  });
});

describe("formatTable", () => {
  test("formats the groups into the report text", () => {
    const groups = [
      {
        team: "dev",
        rows: [
          { name: "alexandra", team: "dev", hours: 8 },
          { name: "bob", team: "dev", hours: 6.5 },
        ],
        total: 14.5,
      },
      { team: "ops", rows: [{ name: "cy", team: "ops", hours: 4.25 }], total: 4.25 },
    ];
    expect(report.formatTable(groups)).toBe(
      [
        "dev",
        "  alexandra  8.00",
        "  bob        6.50",
        "  Total      14.50",
        "",
        "ops",
        "  cy         4.25",
        "  Total      4.25",
      ].join("\n"),
    );
  });

  test("returns No data for an empty array", () => {
    expect(report.formatTable([])).toBe("No data");
  });
});

describe("renderReport built from the three functions", () => {
  test("returns what formatTable makes of groupByTeam of parseRows", () => {
    const text = "name,team,hours\n bob , Ops , 6.5 \n\nann,dev,8\ncy,dev,8\ndee,Ops,0\nbad,row\n";
    expect(report.renderReport(text)).toBe(
      report.formatTable(report.groupByTeam(report.parseRows(text))),
    );
  });

  test("returns No data through the same three calls when no row is valid", () => {
    const text = "name,team,hours\nann,dev\n";
    expect(report.formatTable(report.groupByTeam(report.parseRows(text)))).toBe("No data");
    expect(report.renderReport(text)).toBe("No data");
  });
});
