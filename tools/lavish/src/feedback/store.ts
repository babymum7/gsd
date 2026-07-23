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
  id: number;
  createdAt: string;
  comment: string;
  anchor: Record<string, string> | null;
  attachments: Attachment[];
}

interface FeedbackDocument {
  cursor: number;
  items: FeedbackItem[];
  deliveries: Record<string, number>;
}

function ensureSession(id: string, root: string): SessionRecord {
  const record = readJson<SessionRecord>(sessionFile(id, root));
  if (!record) throw new Error(`unknown session: ${id}`);
  return record;
}

function readDocument(id: string, root: string): FeedbackDocument {
  const document = readJson<FeedbackDocument>(feedbackFile(id, root));
  if (!document) return { cursor: 0, items: [], deliveries: {} };
  if (
    !Number.isInteger(document.cursor) ||
    !Array.isArray(document.items) ||
    typeof document.deliveries !== "object" ||
    document.deliveries === null ||
    Array.isArray(document.deliveries)
  ) {
    throw new Error(`feedback file is malformed: ${feedbackFile(id, root)}`);
  }
  return document;
}

export function readFeedback(id: string, root = projectRoot(), after = 0): { cursor: number; items: FeedbackItem[] } {
  ensureSession(id, root);
  const document = readDocument(id, root);
  return { cursor: document.cursor, items: document.items.filter((item) => item.id > after) };
}

export function appendFeedback(
  id: string,
  input: {
    deliveryId: string;
    comment: string;
    anchor?: Record<string, string> | null;
    attachments?: Attachment[];
  },
  root = projectRoot(),
): FeedbackItem {
  ensureSession(id, root);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(input.deliveryId)) {
    throw new Error("feedback delivery id is invalid");
  }
  const document = readDocument(id, root);
  if (Object.hasOwn(document.deliveries, input.deliveryId)) {
    const existing = document.items.find((item) => item.id === document.deliveries[input.deliveryId]);
    if (!existing) throw new Error(`feedback file is malformed: ${feedbackFile(id, root)}`);
    return existing;
  }
  const item: FeedbackItem = {
    id: document.cursor + 1,
    createdAt: new Date().toISOString(),
    comment: input.comment.trim(),
    anchor: input.anchor ?? null,
    attachments: input.attachments ?? [],
  };
  if (!item.comment && item.attachments.length === 0) throw new Error("feedback needs a comment or attachment");
  document.cursor = item.id;
  document.items.push(item);
  document.deliveries[input.deliveryId] = item.id;
  writeJsonAtomic(feedbackFile(id, root), document);
  return item;
}

