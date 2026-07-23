import type { Attachment } from "../attachments.ts";
import {
  feedbackFile,
  projectRoot,
  readJson,
  sessionFile,
  writeJsonAtomic,
  type SessionRecord,
} from "../paths.ts";

export interface FeedbackItem {
  draftId: string;
  createdAt: string;
  comment: string;
  anchor: Record<string, string> | null;
  attachments: Attachment[];
}

export interface FeedbackDelivery {
  cursor: number;
  deliveryId: string;
  createdAt: string;
  items: FeedbackItem[];
}

export interface AgentReply {
  id: number;
  createdAt: string;
  text: string;
}

interface FeedbackDocument {
  version: 1;
  cursor: number;
  drafts: FeedbackItem[];
  deliveries: FeedbackDelivery[];
  deliveryIds: Record<string, number>;
  replies: AgentReply[];
}

interface FeedbackInput {
  draftId: string;
  comment: string;
  anchor?: Record<string, string> | null;
  attachments?: Attachment[];
}

const ITEM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

function ensureSession(id: string, root: string): SessionRecord {
  const record = readJson<SessionRecord>(sessionFile(id, root));
  if (!record) throw new Error(`unknown session: ${id}`);
  return record;
}

function emptyDocument(): FeedbackDocument {
  return {
    version: 1,
    cursor: 0,
    drafts: [],
    deliveries: [],
    deliveryIds: {},
    replies: [],
  };
}

function readDocument(id: string, root: string): FeedbackDocument {
  const document = readJson<FeedbackDocument>(feedbackFile(id, root));
  if (!document) return emptyDocument();
  if (
    document.version !== 1 ||
    !Number.isInteger(document.cursor) ||
    document.cursor < 0 ||
    !Array.isArray(document.drafts) ||
    !Array.isArray(document.deliveries) ||
    !Array.isArray(document.replies) ||
    typeof document.deliveryIds !== "object" ||
    document.deliveryIds === null ||
    Array.isArray(document.deliveryIds)
  ) {
    throw new Error(`feedback file is malformed: ${feedbackFile(id, root)}`);
  }
  return document;
}

function normalizeInput(input: FeedbackInput, createdAt = new Date().toISOString()): FeedbackItem {
  if (!ITEM_ID_RE.test(input.draftId)) throw new Error("feedback draft id is invalid");
  const comment = typeof input.comment === "string" ? input.comment.trim().slice(0, 20_000) : "";
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  if (!comment && attachments.length === 0) throw new Error("feedback needs a comment or attachment");
  return {
    draftId: input.draftId,
    createdAt,
    comment,
    anchor: input.anchor ?? null,
    attachments,
  };
}

export function readDrafts(id: string, root = projectRoot()): FeedbackItem[] {
  ensureSession(id, root);
  return readDocument(id, root).drafts;
}

export function queueFeedback(
  id: string,
  input: FeedbackInput,
  root = projectRoot(),
): FeedbackItem[] {
  ensureSession(id, root);
  const document = readDocument(id, root);
  const index = document.drafts.findIndex((draft) => draft.draftId === input.draftId);
  const draft = normalizeInput(input, index === -1 ? undefined : document.drafts[index].createdAt);
  if (index === -1) document.drafts.push(draft);
  else document.drafts[index] = draft;
  writeJsonAtomic(feedbackFile(id, root), document);
  return document.drafts;
}

export function removeQueuedFeedback(
  id: string,
  draftId: string,
  root = projectRoot(),
): FeedbackItem[] {
  ensureSession(id, root);
  if (!ITEM_ID_RE.test(draftId)) throw new Error("feedback draft id is invalid");
  const document = readDocument(id, root);
  const next = document.drafts.filter((draft) => draft.draftId !== draftId);
  if (next.length !== document.drafts.length) {
    document.drafts = next;
    writeJsonAtomic(feedbackFile(id, root), document);
  }
  return document.drafts;
}

export function sendFeedback(
  id: string,
  input: { deliveryId: string; current?: FeedbackInput | null },
  root = projectRoot(),
): FeedbackDelivery {
  ensureSession(id, root);
  if (!ITEM_ID_RE.test(input.deliveryId)) throw new Error("feedback delivery id is invalid");
  const document = readDocument(id, root);
  const existingCursor = document.deliveryIds[input.deliveryId];
  if (existingCursor !== undefined) {
    const existing = document.deliveries.find((delivery) => delivery.cursor === existingCursor);
    if (!existing) throw new Error(`feedback file is malformed: ${feedbackFile(id, root)}`);
    return existing;
  }

  const items = [...document.drafts];
  if (input.current) items.push(normalizeInput(input.current));
  if (items.length === 0) throw new Error("Send now requires queued or current feedback");

  const delivery: FeedbackDelivery = {
    cursor: document.cursor + 1,
    deliveryId: input.deliveryId,
    createdAt: new Date().toISOString(),
    items,
  };
  document.cursor = delivery.cursor;
  document.drafts = [];
  document.deliveries.push(delivery);
  document.deliveryIds[input.deliveryId] = delivery.cursor;
  writeJsonAtomic(feedbackFile(id, root), document);
  return delivery;
}

export function appendAgentReply(
  id: string,
  text: string,
  root = projectRoot(),
): AgentReply {
  ensureSession(id, root);
  const value = typeof text === "string" ? text.trim().slice(0, 20_000) : "";
  if (!value) throw new Error("agent reply must not be empty");
  const document = readDocument(id, root);
  const reply: AgentReply = {
    id: document.replies.length + 1,
    createdAt: new Date().toISOString(),
    text: value,
  };
  document.replies.push(reply);
  writeJsonAtomic(feedbackFile(id, root), document);
  return reply;
}

export function readFeedback(
  id: string,
  root = projectRoot(),
  after = 0,
  afterReply = 0,
): {
  cursor: number;
  replyCursor: number;
  deliveries: FeedbackDelivery[];
  replies: AgentReply[];
} {
  ensureSession(id, root);
  if (!Number.isInteger(after) || after < 0) throw new Error("feedback cursor must be a non-negative integer");
  if (!Number.isInteger(afterReply) || afterReply < 0) {
    throw new Error("reply cursor must be a non-negative integer");
  }
  const document = readDocument(id, root);
  return {
    cursor: document.cursor,
    replyCursor: document.replies.at(-1)?.id ?? 0,
    deliveries: document.deliveries.filter((delivery) => delivery.cursor > after),
    replies: document.replies.filter((reply) => reply.id > afterReply),
  };
}
