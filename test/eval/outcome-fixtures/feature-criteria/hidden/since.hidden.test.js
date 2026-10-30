import { describe, expect, test } from "bun:test";
import { filterLogs, parseArgs } from "../src/filter.js";

function messages(entries, argv) {
  return filterLogs(entries, parseArgs(argv)).map((entry) => entry.message);
}

function failure(argv) {
  try {
    parseArgs(argv);
  } catch (error) {
    return error;
  }
  return null;
}

describe("inclusive boundary", () => {
  test("keeps an entry at exactly the since instant and drops an earlier one", () => {
    const entries = [
      { level: "info", message: "earlier", timestamp: "2024-04-30T23:59:59Z" },
      { level: "info", message: "exact", timestamp: "2024-05-01T00:00:00Z" },
      { level: "info", message: "later", timestamp: "2024-05-01T00:00:01Z" },
    ];
    expect(messages(entries, ["--since", "2024-05-01T00:00:00Z"])).toEqual(["exact", "later"]);
  });

  test("compares timestamps as instants, not as text", () => {
    const entries = [
      { level: "info", message: "one millisecond earlier", timestamp: "2024-04-30T23:59:59.999Z" },
      { level: "info", message: "same instant", timestamp: "2024-05-01T00:00:00.000Z" },
      { level: "info", message: "half a second later", timestamp: "2024-05-01T00:00:00.500Z" },
    ];
    expect(messages(entries, ["--since", "2024-05-01T00:00:00Z"])).toEqual([
      "same instant",
      "half a second later",
    ]);
  });
});

describe("invalid date", () => {
  test("throws an Error whose message names the value", () => {
    const error = failure(["--since", "yesterday"]);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("invalid --since date: yesterday");
  });

  test("reports the value exactly as given", () => {
    const error = failure(["--since", "not a date"]);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("invalid --since date: not a date");
  });
});

describe("combined filters", () => {
  const since = "2024-05-01T00:00:00Z";
  const entries = [
    { level: "error", message: "old disk error", timestamp: "2024-04-30T12:00:00Z" },
    { level: "info", message: "new disk notice", timestamp: "2024-05-02T12:00:00Z" },
    { level: "warn", message: "new disk warning", timestamp: "2024-05-02T13:00:00Z" },
    { level: "error", message: "new network error", timestamp: "2024-05-03T12:00:00Z" },
    { level: "error", message: "new disk error", timestamp: "2024-05-04T12:00:00Z" },
  ];

  test("--since and --level must both match", () => {
    expect(messages(entries, ["--level", "warn", "--since", since])).toEqual([
      "new disk warning",
      "new network error",
      "new disk error",
    ]);
  });

  test("--since and --grep must both match", () => {
    expect(messages(entries, ["--since", since, "--grep", "disk"])).toEqual([
      "new disk notice",
      "new disk warning",
      "new disk error",
    ]);
  });

  test("--since, --level, and --grep must all match", () => {
    expect(messages(entries, ["--grep", "disk", "--since", since, "--level", "warn"])).toEqual([
      "new disk warning",
      "new disk error",
    ]);
  });
});

describe("entries without a timestamp", () => {
  const entries = [
    { level: "info", message: "unstamped" },
    { level: "info", message: "stamped", timestamp: "2024-05-02T00:00:00Z" },
    { level: "info", message: "also unstamped" },
  ];

  test("drops them when --since is given", () => {
    expect(messages(entries, ["--since", "2024-05-01T00:00:00Z"])).toEqual(["stamped"]);
  });

  test("keeps them when --since is not given", () => {
    expect(messages(entries, [])).toEqual(["unstamped", "stamped", "also unstamped"]);
  });
});
