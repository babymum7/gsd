import type { AttachmentSource } from "../attachments.ts";
import type { CaptureRegion } from "../injected/capture.ts";

interface NormalizedFeedback {
  draftId: string;
  comment: string;
  anchor: Record<string, string> | null;
  attachmentIds: string[];
}

export type BindingMessage =
  | { type: "ready" }
  | { type: "attachment"; dataUrl: string; source: "upload" | "paste"; name: string }
  | { type: "capture"; mode: "viewport" | "region"; region?: CaptureRegion }
  | ({ type: "queue" } & NormalizedFeedback)
  | { type: "remove"; draftId: string }
  | ({ type: "feedback"; deliveryId: string } & NormalizedFeedback);

const ITEM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function normalizeAnchor(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const anchor: Record<string, string> = {};
  for (const field of ["tag", "id", "role", "name", "text", "selector", "selection"] as const) {
    const fieldValue = boundedString(value[field], field === "text" || field === "selection" ? 240 : 512);
    if (fieldValue) anchor[field] = fieldValue;
  }
  const urlValue = boundedString(value.url, 4096);
  if (urlValue) {
    try {
      const url = new URL(urlValue);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      anchor.url = url.toString();
    } catch {
      // Invalid page URLs are omitted rather than persisted as opaque data.
    }
  }
  return Object.keys(anchor).length === 0 ? null : anchor;
}

function normalizeAttachmentIds(value: unknown): string[] {
  const attachmentIds: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(value)) return attachmentIds;
  for (const item of value) {
    const id = typeof item === "string"
      ? item
      : isRecord(item) && typeof item.id === "string"
        ? item.id
        : "";
    if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    attachmentIds.push(id);
  }
  return attachmentIds;
}

function normalizeFeedback(message: Record<string, unknown>, fallbackDraftId = ""): NormalizedFeedback {
  const draftId = boundedString(message.draftId, 64) || fallbackDraftId;
  if (!ITEM_ID_RE.test(draftId)) throw new Error("feedback draft id is invalid");
  return {
    draftId,
    comment: boundedString(message.comment, 20_000),
    anchor: normalizeAnchor(message.anchor),
    attachmentIds: normalizeAttachmentIds(message.attachments),
  };
}

export function normalizeBindingMessage(payload: string): BindingMessage {
  let message: Record<string, unknown>;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!isRecord(parsed)) throw new Error("message must be an object");
    message = parsed;
  } catch {
    throw new Error("invalid feedback message");
  }

  if (message.type === "ready") return { type: "ready" };
  if (message.type === "attachment") {
    const source: AttachmentSource = message.source === "paste" ? "paste" : "upload";
    const dataUrl = boundedString(message.dataUrl, 14 * 1024 * 1024);
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
      throw new Error("attachment must be a base64 image data URL");
    }
    return {
      type: "attachment",
      dataUrl,
      source,
      name: boundedString(message.name, 255) || "image",
    };
  }
  if (message.type === "capture") {
    const mode = message.mode === "region" ? "region" : "viewport";
    if (mode === "viewport") return { type: "capture", mode };
    if (!isRecord(message.region)) throw new Error("region capture requires geometry");
    const region = {
      x: message.region.x,
      y: message.region.y,
      width: message.region.width,
      height: message.region.height,
    };
    if (!Object.values(region).every((item) => typeof item === "number" && Number.isFinite(item))) {
      throw new Error("capture geometry must contain finite numbers");
    }
    return { type: "capture", mode, region: region as CaptureRegion };
  }
  if (message.type === "queue") return { type: "queue", ...normalizeFeedback(message) };
  if (message.type === "remove") {
    const draftId = boundedString(message.draftId, 64);
    if (!ITEM_ID_RE.test(draftId)) throw new Error("feedback draft id is invalid");
    return { type: "remove", draftId };
  }
  if (message.type === "feedback") {
    const deliveryId = boundedString(message.deliveryId, 64);
    if (!ITEM_ID_RE.test(deliveryId)) throw new Error("feedback delivery id is invalid");
    return {
      type: "feedback",
      deliveryId,
      ...normalizeFeedback(message, deliveryId),
    };
  }
  throw new Error(`unknown message type: ${String(message.type)}`);
}
