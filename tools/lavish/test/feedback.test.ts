import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveDataUrl } from "../src/attachments.ts";
import {
  appendAgentReply,
  queueFeedback,
  readDrafts,
  readFeedback,
  removeQueuedFeedback,
  sendFeedback,
} from "../src/feedback/store.ts";
import { normalizeBindingMessage } from "../src/feedback/protocol.ts";
import { feedbackFile, sessionFile, writeJsonAtomic, type SessionRecord } from "../src/paths.ts";
import { encodeToon } from "../src/toon.ts";
import { startFeedbackControlServer } from "../src/session.ts";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZKx8AAAAASUVORK5CYII=";

function writeSession(root: string, id: string): void {
  const now = new Date().toISOString();
  const record: SessionRecord = {
    id,
    sessionType: "app",
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

test("drafts stay session-local until Send now commits one ordered batch", () => {
  const root = mkdtempSync(join(tmpdir(), "lavish-feedback-"));
  const id = "feedback-session";
  try {
    writeSession(root, id);
    const upload = saveDataUrl(id, PNG_DATA_URL, "upload", "upload.png", root);
    const paste = saveDataUrl(id, PNG_DATA_URL, "paste", "paste.png", root);
    const capture = saveDataUrl(id, PNG_DATA_URL, "viewport", "viewport.png", root);

    queueFeedback(id, {
      draftId: "draft-0001",
      comment: "  Align this panel  ",
      anchor: {
        tag: "section",
        selector: "main > section:nth-of-type(2)",
        text: "Account details",
        url: "https://example.test/settings",
      },
      attachments: [upload],
    }, root);
    queueFeedback(id, {
      draftId: "draft-0002",
      comment: "Second queued item",
      anchor: null,
      attachments: [paste],
    }, root);

    assert.deepEqual(readDrafts(id, root).map((item) => item.comment), [
      "Align this panel",
      "Second queued item",
    ]);
    assert.deepEqual(readFeedback(id, root), {
      cursor: 0,
      replyCursor: 0,
      deliveries: [],
      replies: [],
    });

    const delivery = sendFeedback(id, {
      deliveryId: "delivery-0001",
      current: {
        draftId: "draft-0003",
        comment: "Send now message",
        anchor: null,
        attachments: [capture],
      },
    }, root);
    assert.equal(delivery.cursor, 1);
    assert.deepEqual(delivery.items.map((item) => item.comment), [
      "Align this panel",
      "Second queued item",
      "Send now message",
    ]);
    assert.deepEqual(readDrafts(id, root), []);

    const duplicate = sendFeedback(id, {
      deliveryId: "delivery-0001",
      current: {
        draftId: "draft-duplicate",
        comment: "must not replace the committed delivery",
        anchor: null,
        attachments: [],
      },
    }, root);
    assert.deepEqual(duplicate, delivery);

    const reply = appendAgentReply(id, "Working on the requested changes.", root);
    assert.equal(reply.text, "Working on the requested changes.");
    const history = readFeedback(id, root);
    assert.equal(history.cursor, 1);
    assert.equal(history.deliveries.length, 1);
    assert.equal(history.replies.length, 1);
    assert.deepEqual(readFeedback(id, root, 1).deliveries, []);
    const afterReply = readFeedback(id, root, 1, 1);
    assert.deepEqual(afterReply.replies, []);
    assert.equal(afterReply.replyCursor, 1);

    const persisted = readFileSync(feedbackFile(id, root), "utf8");
    assert.doesNotMatch(persisted, /must-not-enter-feedback|base64,/);
    const toon = encodeToon({ session: id, ...history });
    assert.match(toon, /deliveries\[1\]/);
    assert.match(toon, /upload\.png/);
    assert.doesNotMatch(toon, /attachments:true|base64,/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("queued drafts replace in place and can be removed before delivery", () => {
  const root = mkdtempSync(join(tmpdir(), "lavish-drafts-"));
  const id = "draft-session";
  try {
    writeSession(root, id);
    queueFeedback(id, {
      draftId: "question-0001",
      comment: "First answer",
      anchor: null,
      attachments: [],
    }, root);
    queueFeedback(id, {
      draftId: "question-0001",
      comment: "Updated answer",
      anchor: null,
      attachments: [],
    }, root);
    queueFeedback(id, {
      draftId: "question-0002",
      comment: "Remove me",
      anchor: null,
      attachments: [],
    }, root);
    assert.deepEqual(readDrafts(id, root).map((item) => item.comment), ["Updated answer", "Remove me"]);
    removeQueuedFeedback(id, "question-0002", root);
    assert.deepEqual(readDrafts(id, root).map((item) => item.comment), ["Updated answer"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("long poll waits through queue changes and wakes once for Send now", async () => {
  const root = mkdtempSync(join(tmpdir(), "lavish-poll-"));
  const id = "poll-session";
  let control: ReturnType<typeof startFeedbackControlServer> | null = null;
  try {
    writeSession(root, id);
    const record = JSON.parse(readFileSync(sessionFile(id, root), "utf8")) as SessionRecord;
    control = startFeedbackControlServer(record, root);
    const pollUrl = `http://127.0.0.1:${control.port}/poll?after=0&afterReply=0&timeoutMs=500`;
    const poll = fetch(pollUrl, {
      headers: { authorization: `Bearer ${record.token}` },
    }).then(async (response) => {
      assert.equal(response.status, 200);
      return response.json() as Promise<{
        status: string;
        cursor: number;
        deliveries: { items: { comment: string }[] }[];
      }>;
    });

    assert.equal(await Promise.race([poll.then(() => true), Bun.sleep(25).then(() => false)]), false);
    queueFeedback(id, {
      draftId: "queued-0001",
      comment: "Private draft",
      anchor: null,
      attachments: [],
    }, root);
    assert.equal(await Promise.race([poll.then(() => true), Bun.sleep(25).then(() => false)]), false);

    sendFeedback(id, {
      deliveryId: "delivery-0001",
      current: {
        draftId: "current-0001",
        comment: "Immediate message",
        anchor: null,
        attachments: [],
      },
    }, root);
    control.notifyDelivery();
    const delivered = await poll;
    assert.equal(delivered.status, "feedback");
    assert.equal(delivered.cursor, 1);
    assert.deepEqual(
      delivered.deliveries[0].items.map((item) => item.comment),
      ["Private draft", "Immediate message"],
    );

    const repeated = await fetch(
      `http://127.0.0.1:${control.port}/poll?after=1&afterReply=0&timeoutMs=20`,
      { headers: { authorization: `Bearer ${record.token}` } },
    );
    const repeatedBody = await repeated.json() as { status: string; deliveries: unknown[] };
    assert.equal(repeatedBody.status, "timeout");
    assert.deepEqual(repeatedBody.deliveries, []);

    const endingPoll = fetch(
      `http://127.0.0.1:${control.port}/poll?after=1&afterReply=0&timeoutMs=500`,
      { headers: { authorization: `Bearer ${record.token}` } },
    ).then(async (response) => {
      assert.equal(response.status, 200);
      return response.json() as Promise<{ status: string; deliveries: unknown[] }>;
    });
    await Bun.sleep(10);
    const endedResponse = await fetch(`http://127.0.0.1:${control.port}/end`, {
      method: "POST",
      headers: { authorization: `Bearer ${record.token}` },
    });
    assert.equal(endedResponse.status, 200);
    const endedPoll = await endingPoll;
    assert.equal(endedPoll.status, "ended");
    assert.deepEqual(endedPoll.deliveries, []);
  } finally {
    control?.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});

test("control transport survives transient browser notification failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "lavish-presence-"));
  const id = "presence-session";
  let control: ReturnType<typeof startFeedbackControlServer> | null = null;
  try {
    writeSession(root, id);
    const record = JSON.parse(readFileSync(sessionFile(id, root), "utf8")) as SessionRecord;
    control = startFeedbackControlServer(record, root, {
      onPresence() {
        throw new Error("isolated world is navigating");
      },
      onReply() {
        throw new Error("isolated world was replaced");
      },
    });
    const response = await fetch(
      `http://127.0.0.1:${control.port}/poll?after=0&afterReply=0&timeoutMs=20`,
      { headers: { authorization: `Bearer ${record.token}` } },
    );
    assert.equal(response.status, 200);
    const result = await response.json() as { status: string; deliveries: unknown[] };
    assert.equal(result.status, "timeout");
    assert.deepEqual(result.deliveries, []);
    const replyResponse = await fetch(`http://127.0.0.1:${control.port}/reply`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${record.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: "Repair is complete." }),
    });
    assert.equal(replyResponse.status, 200);
    assert.deepEqual(readFeedback(id, root).replies.map((reply) => reply.text), ["Repair is complete."]);
  } finally {
    control?.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback protocol separates queue, remove, and Send now payloads", () => {
  const queued = normalizeBindingMessage(JSON.stringify({
    type: "queue",
    draftId: "draft-0001",
    comment: "  Align this panel  ",
    anchor: {
      tag: "section",
      selector: "main > section:nth-of-type(2)",
      text: "Account details",
      url: "https://user:secret@example.test/settings?token=private#section",
      cookie: "must-not-survive",
    },
    attachments: ["attachment-0001", { id: "attachment-0002" }, "attachment-0001"],
  }));
  assert.equal(queued.type, "queue");
  if (queued.type !== "queue") throw new Error("expected normalized queue message");
  assert.deepEqual(queued.attachmentIds, ["attachment-0001", "attachment-0002"]);
  assert.equal(queued.anchor?.url, "https://example.test/settings");
  assert.equal("cookie" in (queued.anchor ?? {}), false);

  assert.deepEqual(
    normalizeBindingMessage(JSON.stringify({ type: "remove", draftId: "draft-0001" })),
    { type: "remove", draftId: "draft-0001" },
  );
  const sent = normalizeBindingMessage(JSON.stringify({
    type: "feedback",
    deliveryId: "delivery-0001",
    draftId: "draft-0003",
    comment: "Send now",
    attachments: [],
  }));
  assert.equal(sent.type, "feedback");

  assert.throws(() => normalizeBindingMessage("not-json"), /invalid feedback message/);
  assert.throws(
    () => normalizeBindingMessage(JSON.stringify({ type: "queue", draftId: "x", comment: "ok" })),
    /draft id/,
  );
  assert.throws(
    () => normalizeBindingMessage(JSON.stringify({ type: "attachment", source: "upload", name: "x", dataUrl: "secret" })),
    /base64 image data URL/,
  );
});
