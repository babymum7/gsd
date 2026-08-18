// Pure parsers for the canonical domain Markdown contracts
// (skills/gsd-domain-modeling/SKILL.md § Markdown contracts). Shared by
// tools/gsd-domain.mjs so a session that authors or edits domain docs can prove the grammar
// before returning, instead of only discovering drift at full-suite time.
export const DOMAIN_FILE_MAX_BYTES = 64 * 1024;
export const DOMAIN_SCOPE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const INDEX_HEADER = "| Scope | File | Purpose |";
const INDEX_SEPARATOR = "| --- | --- | --- |";
const TERMS_HEADER = "| Term | Definition | Avoid |";
const TERMS_SEPARATOR = "| --- | --- | --- |";
const SHARD_HEADINGS = [
  "Purpose and responsibilities",
  "Terms",
  "Actors",
  "Invariants",
  "Workflows and state transitions",
  "Commands, events, and outcomes",
  "Context relationships",
  "Domain policies",
];

// The canonical domain files are UTF-8/LF with exact headings and one terminal newline. The
// `AGENTS.md` section check is separate because that file carries unrelated user instructions
// and is not bound by the file-level trailing-newline contract.
function splitLines(content, label) {
  if (typeof content !== "string") {
    throw new Error(`${label} must be a string`);
  }
  if (content.includes("\r")) {
    throw new Error(`${label}: carriage return rejected`);
  }
  if (!content.endsWith("\n") || content.endsWith("\n\n")) {
    throw new Error(`${label}: must end with exactly one newline`);
  }
  const lines = content.split("\n");
  lines.pop();
  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
    throw new Error(`${label} is empty`);
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (/[ \t]$/.test(lines[index])) {
      throw new Error(`${label} line ${index + 1}: trailing whitespace`);
    }
  }
  return lines;
}

function requireContent(scope, heading, body) {
  if (!body.some((line) => line.trim() !== "")) {
    throw new Error(`${scope}: ${heading} must describe current production behavior`);
  }
}

function parseTerms(scope, body) {
  const headerIndex = body.indexOf(TERMS_HEADER);
  if (headerIndex === -1) {
    throw new Error(`${scope}: Terms must declare its header row`);
  }
  if (body[headerIndex + 1] !== TERMS_SEPARATOR) {
    throw new Error(`${scope}: Terms must declare its separator row`);
  }
  const terms = [];
  const seen = new Set();
  for (let index = headerIndex + 2; index < body.length; index += 1) {
    const line = body[index];
    if (line === "") continue;
    const match = line.match(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/);
    if (!match) {
      throw new Error(`${scope}: Terms row is malformed: ${JSON.stringify(line)}`);
    }
    const term = match[1];
    if (seen.has(term)) {
      throw new Error(`${scope}: duplicate term ${JSON.stringify(term)}`);
    }
    seen.add(term);
    terms.push(term);
  }
  if (terms.length === 0) {
    throw new Error(`${scope}: Terms must describe at least one term`);
  }
  const sorted = [...terms].sort();
  for (let index = 0; index < terms.length; index += 1) {
    if (terms[index] !== sorted[index]) {
      throw new Error(`${scope}: Terms must be lexicographically sorted`);
    }
  }
  return terms;
}

function parsePolicies(scope, body) {
  const policies = [];
  let expected = 1;
  for (let index = 0; index < body.length; index += 1) {
    const match = body[index].match(/^### P-([a-z0-9-]+)-(\d+): (.+)$/);
    if (!match) continue;
    if (match[1] !== scope) {
      throw new Error(`${scope}: policy P-${match[1]}-${match[2]} does not belong to this shard`);
    }
    const num = Number(match[2]);
    if (num !== expected) {
      throw new Error(`${scope}: policies must be sequential; expected P-${scope}-${expected}, found P-${scope}-${num}`);
    }
    expected += 1;
    let hasPolicy = false;
    let hasReason = false;
    let cursor = index + 1;
    while (cursor < body.length && !/^### /.test(body[cursor])) {
      if (/^- \*\*Policy:\*\*/.test(body[cursor])) hasPolicy = true;
      if (/^- \*\*Reason:\*\*/.test(body[cursor])) hasReason = true;
      cursor += 1;
    }
    if (!hasPolicy) {
      throw new Error(`${scope}: policy P-${scope}-${num} must state its Policy`);
    }
    if (!hasReason) {
      throw new Error(`${scope}: policy P-${scope}-${num} must state its Reason`);
    }
    policies.push({ num, title: match[3] });
  }
  if (policies.length === 0) {
    throw new Error(`${scope}: Domain policies must declare at least one policy`);
  }
  return policies;
}

export function parseDomainIndex(content) {
  const lines = splitLines(content, "domain index");
  if (lines[0] !== "# Domain Model") {
    throw new Error("domain index must start with `# Domain Model`");
  }
  if (lines[1] !== "" || lines[3] !== "") {
    throw new Error("domain index headings must be separated by single blank lines");
  }
  if (lines[2] !== "## Scopes") {
    throw new Error("domain index must declare `## Scopes`");
  }
  if (lines[4] !== INDEX_HEADER) {
    throw new Error(`domain index must declare ${JSON.stringify(INDEX_HEADER)}`);
  }
  if (lines[5] !== INDEX_SEPARATOR) {
    throw new Error(`domain index must declare ${JSON.stringify(INDEX_SEPARATOR)}`);
  }
  const scopes = [];
  const seen = new Set();
  for (let index = 6; index < lines.length; index += 1) {
    const match = lines[index].match(/^\| ([^|]+) \| `([^`|]+)` \| ([^|]+) \|$/);
    if (!match) {
      throw new Error(`domain index line ${index + 1} is not a Scope row`);
    }
    const [, scope, file, purposeRaw] = match;
    if (!DOMAIN_SCOPE_RE.test(scope)) {
      throw new Error(`domain index has invalid Scope ${JSON.stringify(scope)}`);
    }
    if (file !== `${scope}.md`) {
      throw new Error(`domain index row ${scope}: File must be ${JSON.stringify(`${scope}.md`)}`);
    }
    if (purposeRaw.trim() === "") {
      throw new Error(`domain index row ${scope}: Purpose is required`);
    }
    if (seen.has(scope)) {
      throw new Error(`domain index has duplicate Scope ${scope}`);
    }
    seen.add(scope);
    scopes.push({ scope, file, purpose: purposeRaw });
  }
  if (scopes.length === 0) {
    throw new Error("domain index must declare at least one Scope");
  }
  const sorted = scopes.map((entry) => entry.scope).sort();
  for (let index = 0; index < scopes.length; index += 1) {
    if (scopes[index].scope !== sorted[index]) {
      throw new Error("domain index Scopes must be sorted");
    }
  }
  return { scopes };
}

export function parseDomainScope(content, scope) {
  if (typeof scope !== "string" || !DOMAIN_SCOPE_RE.test(scope)) {
    throw new Error("scope slug must be a lowercase kebab-case name");
  }
  const lines = splitLines(content, `domain shard ${scope}`);
  if (lines[0] !== "# Domain Scope") {
    throw new Error(`${scope}: must start with \`# Domain Scope\``);
  }
  if (lines[1] !== "" || lines[3] !== "" || lines[5] !== "") {
    throw new Error(`${scope}: headings must be separated by single blank lines`);
  }
  if (lines[2] !== "## Scope") {
    throw new Error(`${scope}: must declare \`## Scope\``);
  }
  if (lines[4] !== `\`${scope}\``) {
    throw new Error(`${scope}: \`## Scope\` must name ${JSON.stringify(scope)}`);
  }

  const sections = [];
  let index = 6;
  while (index < lines.length) {
    const match = lines[index].match(/^## (.+)$/);
    if (!match) {
      throw new Error(`${scope}: line ${index + 1} must start a \`##\` section`);
    }
    const heading = match[1];
    const body = [];
    index += 1;
    while (index < lines.length && !/^## /.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    sections.push({ heading, body });
  }

  const headings = sections.map((section) => section.heading);
  if (JSON.stringify(headings) !== JSON.stringify(SHARD_HEADINGS)) {
    throw new Error(`${scope}: sections must appear exactly in order: ${SHARD_HEADINGS.join(", ")}`);
  }

  const terms = parseTerms(scope, sections[1].body);
  const policies = parsePolicies(scope, sections[7].body);
  for (const heading of ["Purpose and responsibilities", "Actors", "Invariants", "Workflows and state transitions", "Commands, events, and outcomes", "Context relationships"]) {
    const section = sections.find((entry) => entry.heading === heading);
    requireContent(scope, heading, section.body);
  }
  return { scope, terms, policies };
}

export function parseAgentsDomainSection(content) {
  if (typeof content !== "string") {
    throw new Error("AGENTS.md must be a string");
  }
  const lines = content.split(/\r?\n/);
  const headings = lines.filter((line) => line.trim() === "## Domain documentation");
  if (headings.length === 0) {
    throw new Error("AGENTS.md must contain a `## Domain documentation` section");
  }
  if (headings.length > 1) {
    throw new Error("AGENTS.md must contain exactly one `## Domain documentation` section");
  }
  return { count: 1 };
}
