// Timesheet report: turns text with one `name,team,hours` row per line into a plain-text table,
// one block per team with its rows, busiest first, and a total line.
const TOTAL_LABEL = "Total";
const HOURS_PATTERN = /^\d+(\.\d+)?$/;

export function parseRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const fields = line.split(",").map((field) => field.trim());
    const [name, team, hours] = fields;
    if (fields.length < 3 || !name || !team || !HOURS_PATTERN.test(hours)) continue;
    rows.push({ name, team, hours: Number(hours) });
  }
  return rows;
}

export function groupByTeam(rows) {
  const byTeam = new Map();
  for (const row of rows) {
    if (!byTeam.has(row.team)) byTeam.set(row.team, []);
    byTeam.get(row.team).push(row);
  }
  return [...byTeam.keys()].sort().map((team) => {
    const members = byTeam.get(team).sort((a, b) => b.hours - a.hours);
    let total = 0;
    for (const { hours } of members) total += hours;
    return { team, rows: members, total };
  });
}

export function formatTable(groups) {
  if (groups.length === 0) return "No data";
  let width = TOTAL_LABEL.length;
  for (const { rows } of groups) {
    for (const { name } of rows) width = Math.max(width, name.length);
  }

  const blocks = groups.map(({ team, rows, total }) => {
    const lines = [team];
    for (const { name, hours } of rows) {
      lines.push(`  ${name.padEnd(width)}  ${hours.toFixed(2)}`);
    }
    lines.push(`  ${TOTAL_LABEL.padEnd(width)}  ${total.toFixed(2)}`);
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

export function renderReport(text) {
  return formatTable(groupByTeam(parseRows(text)));
}
