// Timesheet report: turns text with one `name,team,hours` row per line into a plain-text table,
// one block per team with its rows, busiest first, and a total line.
const TOTAL_LABEL = "Total";
const HOURS_PATTERN = /^\d+(\.\d+)?$/;

export function renderReport(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const fields = line.split(",").map((field) => field.trim());
    const [name, team, hours] = fields;
    if (fields.length < 3 || !name || !team || !HOURS_PATTERN.test(hours)) continue;
    rows.push({ name, team, hours: Number(hours) });
  }
  if (rows.length === 0) return "No data";

  const byTeam = new Map();
  for (const row of rows) {
    if (!byTeam.has(row.team)) byTeam.set(row.team, []);
    byTeam.get(row.team).push(row);
  }
  let width = TOTAL_LABEL.length;
  for (const { name } of rows) width = Math.max(width, name.length);

  const blocks = [];
  for (const team of [...byTeam.keys()].sort()) {
    const members = byTeam.get(team).sort((a, b) => b.hours - a.hours);
    const lines = [team];
    let total = 0;
    for (const { name, hours } of members) {
      lines.push(`  ${name.padEnd(width)}  ${hours.toFixed(2)}`);
      total += hours;
    }
    lines.push(`  ${TOTAL_LABEL.padEnd(width)}  ${total.toFixed(2)}`);
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}
