import { describe, expect, test } from "bun:test";
import { filterLogs, parseArgs } from "../src/filter.js";

const entries = [
  { level: "debug", message: "cache warmed", timestamp: "2024-04-30T08:00:00Z" },
  { level: "info", message: "server started", timestamp: "2024-05-01T09:30:00Z" },
  { level: "warn", message: "Disk usage at 91%", timestamp: "2024-05-01T10:15:00Z" },
  { level: "error", message: "disk write failed", timestamp: "2024-05-02T11:45:00Z" },
  { level: "info", message: "legacy import finished" },
];

function run(argv) {
  return filterLogs(entries, parseArgs(argv)).map((entry) => entry.message);
}

describe("filterLogs", () => {
  test("keeps every entry when no option is given", () => {
    expect(run([])).toEqual(entries.map((entry) => entry.message));
  });

  test("--level keeps entries at that level or more severe", () => {
    expect(run(["--level", "warn"])).toEqual(["Disk usage at 91%", "disk write failed"]);
    expect(run(["--level", "error"])).toEqual(["disk write failed"]);
  });

  test("--grep keeps entries whose message contains the text, ignoring case", () => {
    expect(run(["--grep", "DISK"])).toEqual(["Disk usage at 91%", "disk write failed"]);
    expect(run(["--grep", "started"])).toEqual(["server started"]);
  });

  test("--level and --grep together keep entries matching both", () => {
    expect(run(["--level", "error", "--grep", "disk"])).toEqual(["disk write failed"]);
    expect(run(["--grep", "started", "--level", "warn"])).toEqual([]);
  });

  test("keeps entries without a timestamp", () => {
    expect(run(["--level", "info"])).toContain("legacy import finished");
    expect(run(["--grep", "legacy"])).toEqual(["legacy import finished"]);
  });
});

describe("parseArgs", () => {
  test("rejects an unknown option", () => {
    expect(() => parseArgs(["--verbose"])).toThrow("unknown option: --verbose");
    expect(() => parseArgs(["--grep", "disk", "stray"])).toThrow("unknown option: stray");
  });

  test("rejects an option without a value", () => {
    expect(() => parseArgs(["--grep"])).toThrow("missing value for --grep");
    expect(() => parseArgs(["--level", "warn", "--level"])).toThrow("missing value for --level");
  });

  test("rejects an unknown level", () => {
    expect(() => parseArgs(["--level", "fatal"])).toThrow("invalid --level: fatal");
  });
});
