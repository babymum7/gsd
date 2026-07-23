import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveDataUrl } from "../src/attachments.ts";
import { appendFeedback, readFeedback } from "../src/feedback/store.ts";
import { normalizeBindingMessage } from "../src/feedback/protocol.ts";
import { feedbackFile, sessionFile, writeJsonAtomic, type SessionRecord } from "../src/paths.ts";
import { encodeToon } from "../src/toon.ts";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZKx8AAAAASUVORK5CYII=";

function writeSession(root: string, id: string): void {
  const now = new Date().toISOString();
  const record: SessionRecord = {
    id,
    projectRoot: root,
    target: { kind: "url", value: "http://fixture.test" },
    state: "ready",
    createdAt: now,
    updatedAt: now,
    profileDir: "/state/lavish/profile",
    controlPort: 4321,
    cdpPort: 9222,
    token: "must-not-enter-feedback",
    pid: null,
  };
  writeJsonAtomic(sessionFile(id, root), record);
}

test("upload, paste, and capture metadata stay ordered and deduplicate delivery", () => {
  const root = mkdtempSync(join(tmpdir(), "lavish-feedback-"));
  const id = "feedback-session";
  try {
    writeSession(root, id);
    const upload = saveDataUrl(id, PNG_DATA_URL, "upload", "upload.png", root);
    const paste = saveDataUrl(id, PNG_DATA_URL, "paste", "paste.png", root);
    const capture = saveDataUrl(id, PNG_DATA_URL, "viewport", "viewport.png", root);

    const normalized = normalizeBindingMessage(JSON.stringify({
      type: "feedback",
      deliveryId: "delivery-0001",
      comment: "  Align this panel  ",
      anchor: {
        tag: "section",
        selector: "main > section:nth-of-type(2)",
        text: "Account details",
        url: "https://user:secret@example.test/settings?token=private#section",
        cookie: "must-not-survive",
      },
      attachments: [upload, { id: paste.id }, capture.id, { id: paste.id }],
    }));
    assert.equal(normalized.type, "feedback");
    if (normalized.type !== "feedback") throw new Error("expected normalized feedback");
    assert.deepEqual(normalized.attachmentIds, [upload.id, paste.id, capture.id]);
    assert.equal(normalized.anchor?.url, "https://example.test/settings");
    assert.equal("cookie" in (normalized.anchor ?? {}), false);

    const attachments = new Map([
      [upload.id, upload],
      [paste.id, paste],
      [capture.id, capture],
    ]);
    const first = appendFeedback(id, {
      deliveryId: normalized.deliveryId,
      comment: normalized.comment,
      anchor: normalized.anchor,
      attachments: normalized.attachmentIds.map((attachmentId) => attachments.get(attachmentId)!),
    }, root);
    const duplicate = appendFeedback(id, {
      deliveryId: normalized.deliveryId,
      comment: "duplicate should not replace original",
      anchor: null,
      attachments: [],
    }, root);
    assert.deepEqual(duplicate, first);

    appendFeedback(id, {
      deliveryId: "delivery-0002",
      comment: "Second item",
      anchor: null,
      attachments: [],
    }, root);
    const result = readFeedback(id, root);
    assert.equal(result.cursor, 2);
    assert.deepEqual(result.items.map((item) => item.comment), ["Align this panel", "Second item"]);
    assert.deepEqual(result.items[0].attachments.map((attachment) => attachment.source), ["upload", "paste", "viewport"]);

    const persisted = readFileSync(feedbackFile(id, root), "utf8");
    assert.doesNotMatch(persisted, /must-not-enter-feedback|secret|token=|base64,/);
    const toon = encodeToon({ session: id, cursor: result.cursor, feedback: result.items });
    assert.match(toon, /attachments\[3\]\{id,path,name,mime,bytes,width,height,sha256,source\}/);
    assert.match(toon, /upload\.png/);
    assert.doesNotMatch(toon, /attachments:true|base64,/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback protocol rejects malformed and credential-shaped payloads", () => {
  assert.throws(() => normalizeBindingMessage("not-json"), /invalid feedback message/);
  assert.throws(
    () => normalizeBindingMessage(JSON.stringify({ type: "feedback", deliveryId: "x", comment: "ok" })),
    /delivery id/,
  );
  assert.throws(
    () => normalizeBindingMessage(JSON.stringify({ type: "attachment", source: "upload", name: "x", dataUrl: "secret" })),
    /base64 image data URL/,
  );
});
