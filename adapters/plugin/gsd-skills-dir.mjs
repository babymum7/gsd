import fs from 'node:fs';
import path from 'node:path';
import { discoverSkillCatalog } from '../../lib/gsd-bootstrap.mjs';

// A skills-only install serves harnesses GSD ships no adapter for: they discover skill
// directories but run no session hook, so nothing injects the bootstrap, `GSD_ROOT`, or
// `GSD_SESSION`. Each written skill therefore carries its absolute core path, and a visible
// `gsd` router skill stands in for the bootstrap.
const SKILL_MARKER = '.gsd-skill';
const ROUTER_NAME = 'gsd';
// Every skills-only session shares this owner: there is no host session id to scope packets.
export const SKILLS_ONLY_SESSION = 'skills-only';
const ROUTER_DESCRIPTION =
  'Load first for GSD work: new or changed behavior, design, a bug with unknown cause, diff review, or continuing a .scratch packet.';
const HOST_LOADED_SENTENCE = 'The host already loaded this; never reload it. ';

function stripFrontmatter(content, filePath) {
  const normalized = content.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (!normalized.startsWith('---\n') || end === -1) throw new Error(`${filePath}: invalid YAML frontmatter`);
  return normalized.slice(end + 5).replace(/^\n/, '');
}

function renderRouter(coreRoot) {
  const masterPath = path.join(coreRoot, 'skills', ROUTER_NAME, 'SKILL.md');
  const body = stripFrontmatter(fs.readFileSync(masterPath, 'utf8'), masterPath);
  if (!body.includes(HOST_LOADED_SENTENCE)) {
    throw new Error(`${masterPath}: master body no longer states that the host loaded it`);
  }
  return [
    '---',
    `name: ${ROUTER_NAME}`,
    `description: ${JSON.stringify(ROUTER_DESCRIPTION)}`,
    '---',
    '',
    'No host adapter runs here, so this skill stands in for the session bootstrap: read it once per session.',
    `GSD_ROOT: ${JSON.stringify(coreRoot)}`,
    `GSD_SESSION: ${SKILLS_ONLY_SESSION}`,
    'Sibling skills sit beside this directory as `<name>/SKILL.md`. No recovery capsule follows compaction: `continue` resumes through `gsd-executing-plans`.',
    '',
    body.replace(HOST_LOADED_SENTENCE, ''),
  ].join('\n');
}

function copyResolved(source, target, coreRoot) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyResolved(from, to, coreRoot);
    else if (entry.name.endsWith('.md')) {
      fs.writeFileSync(to, fs.readFileSync(from, 'utf8').replaceAll('<GSD_ROOT>', () => coreRoot));
    } else fs.copyFileSync(from, to);
  }
}

export function skillsDirNames(coreRoot) {
  return [ROUTER_NAME, ...discoverSkillCatalog(coreRoot).map((row) => row.name).sort()];
}

export function writeSkillsDir(coreRoot, targetDir) {
  const names = skillsDirNames(coreRoot);
  // Refuse before writing anything, so a name clash never leaves a half-written install.
  for (const name of names) {
    const target = path.join(targetDir, name);
    if (fs.existsSync(target) && !fs.existsSync(path.join(target, SKILL_MARKER))) {
      throw new Error(`${target}: exists and is not a GSD-managed skill`);
    }
  }
  for (const name of names) {
    const target = path.join(targetDir, name);
    fs.rmSync(target, { recursive: true, force: true });
    copyResolved(path.join(coreRoot, 'skills', name), target, coreRoot);
    if (name === ROUTER_NAME) fs.writeFileSync(path.join(target, 'SKILL.md'), renderRouter(coreRoot));
    fs.writeFileSync(path.join(target, SKILL_MARKER), '');
  }
  return names;
}

export function removeSkillsDir(targetDir) {
  if (!fs.existsSync(targetDir)) return [];
  const removed = [];
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory() && fs.existsSync(path.join(target, SKILL_MARKER))) {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(entry.name);
    }
  }
  return removed.sort();
}
