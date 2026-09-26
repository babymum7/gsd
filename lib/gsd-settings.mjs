// User GSD settings at `<GSD home>/settings.json`. The plugin ships no model names:
// each sub-agent profile maps a host key to a user-chosen value that the owner passes
// at spawn time. Host keys and each host's spawn field belong to the adapters; this
// core only validates the shape. An absent file changes nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SETTINGS_VERSION = 1;
const SETTINGS_PROFILES = ['scout', 'worker'];
const SETTINGS_HOST_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const SETTINGS_VALUE_MAX_BYTES = 200;

function resolveSettingsHome(env = process.env) {
  return path.resolve(env.GSD_HOME || path.join(os.homedir(), '.gsd'));
}

function settingsPath(home) {
  return path.join(home, 'settings.json');
}

function validateSettingsValue(value, label) {
  if (
    typeof value !== 'string' ||
    value === '' ||
    Buffer.byteLength(value) > SETTINGS_VALUE_MAX_BYTES ||
    /[\s`"\\]|[\p{Cc}]/u.test(value)
  ) {
    throw new Error(
      `${label}: value must be a non-empty string of at most ${SETTINGS_VALUE_MAX_BYTES} bytes without whitespace, quotes, backticks, backslashes, or control characters`,
    );
  }
}

function validateSettings(settings, label = 'settings') {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`${label}: must be a JSON object`);
  }
  if (settings.version !== SETTINGS_VERSION) {
    throw new Error(`${label}: version must be ${SETTINGS_VERSION}`);
  }
  for (const key of Object.keys(settings)) {
    if (key !== 'version' && key !== 'profiles') throw new Error(`${label}: unknown key ${key}`);
  }
  const profiles = settings.profiles ?? {};
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error(`${label}: profiles must be an object`);
  }
  for (const [profile, hosts] of Object.entries(profiles)) {
    if (!SETTINGS_PROFILES.includes(profile)) {
      throw new Error(`${label}: unknown profile ${profile} (expected ${SETTINGS_PROFILES.join(', ')})`);
    }
    if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) {
      throw new Error(`${label}: profiles.${profile} must be an object`);
    }
    for (const [host, value] of Object.entries(hosts)) {
      if (!SETTINGS_HOST_PATTERN.test(host)) {
        throw new Error(`${label}: invalid host key ${profile}.${host}`);
      }
      validateSettingsValue(value, `${label}: ${profile}.${host}`);
    }
  }
  return settings;
}

function readSettings(home) {
  const file = settingsPath(home);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`${file}: cannot read GSD settings (${error.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${file}: invalid JSON (${error.message})`);
  }
  return validateSettings(parsed, file);
}

function writeSettings(home, settings) {
  const file = settingsPath(home);
  validateSettings(settings, file);
  fs.mkdirSync(home, { recursive: true });
  const temp = `${file}.gsd-tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function parseSettingsKey(key, hosts) {
  const [profile, host, extra] = String(key ?? '').split('.');
  if (extra !== undefined || !SETTINGS_PROFILES.includes(profile) || !hosts.includes(host)) {
    throw new Error(
      `key must be <profile>.<host> with profile ${SETTINGS_PROFILES.join('|')} and host ${hosts.join('|')}`,
    );
  }
  return { profile, host };
}

// The per-host block an adapter places inside the bootstrap, naming the host's own spawn
// field; empty when the user set nothing for this host, so the bootstrap stays
// byte-identical to the core render.
function renderSubagentProfiles(settings, host, spawnField) {
  if (!settings) return '';
  const entries = SETTINGS_PROFILES.flatMap((profile) => {
    const value = settings.profiles?.[profile]?.[host];
    return value ? [`${profile} \`${value}\``] : [];
  });
  if (entries.length === 0) return '';
  return `## Sub-agent profiles\nUser GSD settings; pass as ${spawnField} when spawning that profile: ${entries.join(', ')}.`;
}

// Invalid settings never block the bootstrap; `gsd config list` reports the error.
function loadSubagentProfiles(host, spawnField, env = process.env) {
  try {
    return renderSubagentProfiles(readSettings(resolveSettingsHome(env)), host, spawnField);
  } catch {
    return '';
  }
}

function withSubagentProfiles(bootstrap, block) {
  const closing = '\n</GSD_BOOTSTRAP>';
  if (!block || !bootstrap.endsWith(closing)) return bootstrap;
  return `${bootstrap.slice(0, -closing.length)}\n\n${block}${closing}`;
}

export {
  SETTINGS_PROFILES,
  SETTINGS_VERSION,
  loadSubagentProfiles,
  parseSettingsKey,
  readSettings,
  renderSubagentProfiles,
  resolveSettingsHome,
  settingsPath,
  validateSettings,
  withSubagentProfiles,
  writeSettings,
};
