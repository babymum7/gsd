type ToonScalar = string | number | boolean | null;
type ToonValue = ToonScalar | ToonValue[] | { [key: string]: ToonValue };

function quote(value: string): string {
  if (
    value !== "" &&
    /^[A-Za-z0-9_./:-]+$/.test(value) &&
    !["true", "false", "null"].includes(value)
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function scalar(value: ToonScalar): string {
  if (typeof value === "string") return quote(value);
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  return value ? "true" : "false";
}

function isObject(value: ToonValue): value is { [key: string]: ToonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fields(items: { [key: string]: ToonValue }[]): string[] | null {
  if (items.length === 0) return [];
  const names = Object.keys(items[0]);
  if (!items.every((item) => Object.keys(item).join("\u0000") === names.join("\u0000"))) {
    return null;
  }
  return names;
}

function renderValue(key: string, value: ToonValue, depth: number): string[] {
  const pad = "  ".repeat(depth);
  if (!Array.isArray(value) && !isObject(value)) return [`${pad}${key}:${scalar(value)}`];

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}[0]:`];
    const rows = value.every(isObject) ? (value as { [key: string]: ToonValue }[]) : null;
    const objectFields = rows ? fields(rows) : null;
    if (
      rows &&
      objectFields &&
      rows.every((row) => objectFields.every((name) => !Array.isArray(row[name]) && !isObject(row[name])))
    ) {
      return [
        `${pad}${key}[${rows.length}]{${objectFields.join(",")}}:`,
        ...rows.map((row) => `${pad}  ${objectFields.map((name) => scalar(row[name] as ToonScalar)).join(",")}`),
      ];
    }
    return [
      `${pad}${key}[${value.length}]:`,
      ...value.flatMap((item) => {
        if (Array.isArray(item) || isObject(item)) {
          return [`${pad}  -`, ...renderValue("value", item, depth + 1).slice(1)];
        }
        return [`${pad}  - ${scalar(item)}`];
      }),
    ];
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return [`${pad}${key}:`];
  return [`${pad}${key}:`, ...entries.flatMap(([name, child]) => renderValue(name, child, depth + 1))];
}

export function encodeToon(value: { [key: string]: ToonValue }): string {
  return Object.entries(value)
    .flatMap(([key, child]) => renderValue(key, child, 0))
    .join("\n");
}

export function writeToon(value: { [key: string]: ToonValue }): void {
  process.stdout.write(`${encodeToon(value)}\n`);
}

export function writeToonError(code: string, message: string, help?: string): void {
  const payload: { [key: string]: ToonValue } = { error: code, message };
  if (help) payload.help = help;
  writeToon(payload);
}
