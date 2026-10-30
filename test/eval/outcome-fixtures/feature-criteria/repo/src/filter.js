const LEVELS = ["debug", "info", "warn", "error"];
const OPTIONS = ["--level", "--grep"];

export function parseArgs(argv) {
  const options = { level: null, grep: null };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!OPTIONS.includes(name)) throw new Error(`unknown option: ${name}`);
    if (value === undefined) throw new Error(`missing value for ${name}`);
    if (name === "--level") {
      if (!LEVELS.includes(value)) throw new Error(`invalid --level: ${value}`);
      options.level = value;
    } else {
      options.grep = value;
    }
  }
  return options;
}

const severity = (level) => LEVELS.indexOf(level);
const contains = (text, part) => text.toLowerCase().includes(part.toLowerCase());

export function filterLogs(entries, options) {
  return entries.filter((entry) => {
    if (options.level !== null && severity(entry.level) < severity(options.level)) return false;
    if (options.grep !== null && !contains(entry.message, options.grep)) return false;
    return true;
  });
}
