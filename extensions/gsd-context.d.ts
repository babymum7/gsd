/** GSD state file schema version. */
export type StateSchema = "v4";

/** Active (non-terminal) lifecycle phases. */
export type ActivePhase = "draft" | "approved" | "executing" | "paused" | "verifying" | "repair" | "merged-cleanup-pending";

/** Terminal lifecycle phases. */
export type CompletedPhase = "completed-retained";

/** Any valid state phase. */
export type Phase = ActivePhase | CompletedPhase;

/** Canonical state.toon field order. */
export interface State {
  schema: StateSchema;
  feature: string;
  phase: Phase;
  next_action: string;
  plan_path: string;
  plan_sha256: string;
  base_ref: string;
  wip_branch: string;
  last_green_task: string;
  last_green_commit: string;
  autosync: string;
  cleanup_preference: string;
  checkpoint_revision: string;
}

/** Parsed SKILL.md frontmatter metadata. */
export interface SkillMetadata {
  name: string;
  description: string;
  hidden: boolean;
}

/** A visible skill catalog row. */
export interface SkillCatalogRow {
  name: string;
  description: string;
  skillPath: string;
}

/** Frozen array of active state phases. */
export const ACTIVE_STATE_PHASES: readonly ActivePhase[];

/** Frozen array of completed state phases. */
export const COMPLETED_STATE_PHASES: readonly CompletedPhase[];

/** Frozen canonical v4 field order for a state.toon packet. */
export const STATE_FIELD_ORDER: readonly (keyof State)[];

/** The raw capsule template string with unreplaced tokens. */
export const CAPSULE_TEMPLATE: string;

/**
 * Render a compaction recovery capsule from active feature names.
 * @param features - Kebab-case feature slugs (max 5 displayed; excess truncated).
 * @param gsdRoot - Absolute path to the GSD repository root.
 * @returns Rendered capsule text (≤ 4000 bytes).
 */
export function createCapsule(features: string[], gsdRoot: string): string;

/**
 * Discover active feature candidates under `cwd/.scratch/`.
 * @param cwd - Working directory containing `.scratch/`.
 * @param options - Optional flags. `faultTolerant: true` skips malformed packets and collects defects instead of throwing.
 * @returns Object with `candidates` (sorted active feature names) and `defects` (error messages for skipped malformed packets).
 */
export function detectCandidates(cwd: string, options?: { faultTolerant?: boolean }): { candidates: string[]; defects: string[] };

/**
 * Discover the visible skill catalog for a GSD root.
 * @param gsdRoot - Absolute path to the GSD repository root.
 * @returns Array of visible skill catalog rows.
 */
export function discoverSkillCatalog(gsdRoot: string): SkillCatalogRow[];

/**
 * Find the index of the first message that is not a compaction summary.
 * @param messages - Array of chat message objects.
 * @returns Index of the first non-compaction-summary message.
 */
export function firstNonCompactionSummaryIndex(messages: Array<{ role?: string }>): number;

/**
 * Check whether a message contains an expected bootstrap string.
 * @param message - Chat message object with `content` and/or `summary`.
 * @param expectedBootstrap - Exact expected bootstrap text, or omit to check for any GSD bootstrap.
 * @returns Whether the message contains the bootstrap.
 */
export function messageContainsBootstrap(
  message: { content?: string | Array<{ text?: string }>; summary?: string },
  expectedBootstrap?: string,
): boolean;

/**
 * Parse SKILL.md frontmatter into structured metadata.
 * @param content - Raw SKILL.md file content.
 * @param filePath - File path for error messages.
 * @returns Parsed metadata with name, description, and hidden flag.
 */
export function parseSkillMetadata(content: string, filePath: string): SkillMetadata;

/**
 * Parse a state.toon string into a validated State object.
 * @param content - Raw state.toon file content.
 * @param label - Error label (default: "state.toon").
 * @returns Validated state object.
 */
export function parseState(content: string, label?: string): State;

/**
 * Read and validate a state.toon file from disk through fd-anchored, TOCTOU-hardened
 * I/O. A legacy v1/v2/v3 packet is migrated in place to canonical v4 as a side effect.
 * @param statePath - Absolute path to a state.toon file.
 * @returns Validated state object.
 */
export function readStateFile(statePath: string): State;

/**
 * Read and validate a state.toon file with the same hardening as `readStateFile`
 * but never writing: legacy packets are parsed and returned unmigrated.
 * @param statePath - Absolute path to a state.toon file.
 * @returns Validated state object.
 */
export function inspectStateFile(statePath: string): State;

/**
 * Serialize a State object to state.toon format.
 * @param input - Validated state object.
 * @returns Serialized state.toon string.
 */
export function serializeState(input: State): string;

/**
 * Validate a raw state object, enforcing schema, field order, and phase constraints.
 * @param input - Raw object with state fields.
 * @param label - Error label (default: "state.toon").
 * @returns Validated and normalized state object.
 */
export function validateState(input: Record<string, string>, label?: string): State;

/**
 * Atomically write a state.toon file to the feature's directory.
 * @param featureDir - Absolute path to the feature directory under `.scratch/`.
 * @param input - Validated state object to write.
 */
export function writeStateAtomic(featureDir: string, input: State): State;

/**
 * Create the full GSD bootstrap injection string.
 * @param gsdRoot - Absolute path to the GSD repository root.
 * @returns Bootstrap XML string for session injection.
 */
export function createBootstrap(gsdRoot: string): string;

/** Default export: the OMP context extension factory function. */
export default function gsdContextExtension(pi: unknown): void;
