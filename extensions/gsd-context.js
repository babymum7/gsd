const fs = require('fs');
const path = require('path');

const CAPSULE_TEMPLATE = `[GSD Recovery Capsule]
Active GSD features: <features>
To resume execution, perform direct-root rehydration in this exact order:
1. Load master (gsd) from <GSD_ROOT>/skills/gsd/SKILL.md first.
2. <resume_instruction>
Stop immediately on any malformed or ambiguous state, or if the intent is unrelated to the active features.`;

function createCapsule(features, gsdRoot) {
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error("At least one active feature is required");
  }
  if (!gsdRoot || typeof gsdRoot !== 'string') {
    throw new Error("GSD_ROOT is a required capsule input");
  }
  if (!path.isAbsolute(gsdRoot)) {
    throw new Error("GSD_ROOT must be an absolute path");
  }
  if (/[\x00-\x1F\x7F]/.test(gsdRoot)) {
    throw new Error("GSD_ROOT contains invalid control characters");
  }

  const rootBytes = Buffer.byteLength(gsdRoot, 'utf8');
  if (rootBytes > 1024) {
    throw new Error("GSD_ROOT path length exceeds limit of 1024 bytes");
  }

  const masterPath = `${gsdRoot}/skills/gsd/SKILL.md`;
  const masterPathBytes = Buffer.byteLength(masterPath, 'utf8');
  if (masterPathBytes > 1024) {
    throw new Error("Emitted master path length exceeds limit of 1024 bytes");
  }

  // Accept only unique stable kebab-case feature slugs
  const seen = new Set();
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    if (typeof feature !== 'string') {
      throw new Error("Feature must be a string");
    }
    const slugBytes = Buffer.byteLength(feature, 'utf8');
    if (slugBytes > 255) {
      throw new Error("Feature slug exceeds field length cap of 255 bytes");
    }
    if (/[\x00-\x1F\x7F]/.test(feature)) {
      throw new Error("Invalid feature slug: must be kebab-case (control characters are rejected)");
    }
    if (/[/\\.]/.test(feature)) {
      throw new Error("Invalid feature slug: must be kebab-case (path separators or dots are rejected)");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature)) {
      throw new Error("Invalid feature slug: must be kebab-case");
    }
    if (seen.has(feature)) {
      throw new Error("Duplicate features are not allowed");
    }
    seen.add(feature);
  }

  const sorted = [...features].sort();
  const isOverCap = features.length > 5;
  const prefix = isOverCap ? sorted.slice(0, 5) : sorted;
  const omittedCount = isOverCap ? features.length - 5 : 0;

  let featuresStr = prefix.join(", ");
  if (isOverCap) {
    featuresStr += ` (and ${omittedCount} more)`;
  }

  const resumeInstruction = isOverCap
    ? "Stop immediately and select exactly one active feature to resume."
    : "Delegate one complete ordinary Route 1 resume to that master's ordinary Route 1 algorithm.";

  const capsule = `[GSD Recovery Capsule]
Active GSD features: ${featuresStr}
To resume execution, perform direct-root rehydration in this exact order:
1. Load master (gsd) from ${masterPath} first.
2. ${resumeInstruction}
Stop immediately on any malformed or ambiguous state, or if the intent is unrelated to the active features.`;

  const capsuleBytes = Buffer.byteLength(capsule, 'utf8');
  if (capsuleBytes > 4000) {
    throw new Error(`Complete capsule size (${capsuleBytes} bytes) exceeds limit of 4000 bytes`);
  }

  return capsule;
}

function detectCandidates(cwd) {
  const scratchDir = path.join(cwd, '.scratch');
  if (!fs.existsSync(scratchDir)) {
    return [];
  }
  try {
    const stats = fs.statSync(scratchDir);
    if (!stats.isDirectory()) {
      return [];
    }
  } catch (e) {
    return [];
  }

  let entries = [];
  try {
    entries = fs.readdirSync(scratchDir, { withFileTypes: true });
  } catch (e) {
    return [];
  }

  const candidates = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const name = entry.name;
      // Accept only eligible kebab-case feature slugs <= 255 UTF-8 bytes
      if (Buffer.byteLength(name, 'utf8') > 255 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        continue;
      }
      const featureDir = path.join(scratchDir, name);
      let subEntries = [];
      try {
        subEntries = fs.readdirSync(featureDir, { withFileTypes: true });
      } catch (e) {
        continue;
      }

      let hasPlan = false;
      let hasResult = false;
      let hasHandoff = false;

      for (const subEntry of subEntries) {
        if (subEntry.name === 'plan.md') {
          if (subEntry.isFile()) {
            hasPlan = true;
          }
        } else if (subEntry.name === 'result.toon') {
          hasResult = true;
        } else if (/^handoff-[1-9]\d*\.toon$/.test(subEntry.name)) {
          if (subEntry.isFile()) {
            hasHandoff = true;
          }
        }
      }

      if (hasPlan && !hasResult && hasHandoff) {
        candidates.push(name);
      }
    }
  }

  return candidates.sort();
}

function gsdContextExtension(pi) {
  // Derive GSD_ROOT via realpathSync(__filename) source location
  const extPath = fs.realpathSync(__filename);
  const GSD_ROOT = path.dirname(path.dirname(extPath));

  // Store the exact pending capsule computed during session.compacting
  let pendingCapsule = null;

  // Register event handlers
  pi.on("session.compacting", async (event, ctx) => {
    const cwd = ctx?.cwd || process.cwd();
    const features = detectCandidates(cwd);
    if (features.length === 0) {
      pendingCapsule = null;
      return {};
    }
    const capsule = createCapsule(features, GSD_ROOT);
    pendingCapsule = capsule;
    return { context: [capsule] };
  });

  pi.on("session_compact", async (event, ctx) => {
    if (pendingCapsule) {
      const capsuleToSend = pendingCapsule;
      pendingCapsule = null; // Clear pending state
      await pi.sendMessage(capsuleToSend, {
        deliverAs: "nextTurn",
        triggerTurn: false
      });
    }
  });
}


// Attach helpers to the factory function object
gsdContextExtension.createCapsule = createCapsule;
gsdContextExtension.CAPSULE_TEMPLATE = CAPSULE_TEMPLATE;
gsdContextExtension.detectCandidates = detectCandidates;

module.exports = gsdContextExtension;
