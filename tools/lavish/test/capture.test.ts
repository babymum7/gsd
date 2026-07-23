import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveDataUrl } from "../src/attachments.ts";
import { capturePng, type PageClient } from "../src/cdp/page.ts";
import { sessionFile, writeJsonAtomic, type SessionRecord } from "../src/paths.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZKx8AAAAASUVORK5CYII=";

class FakePage implements PageClient {
  readonly requests: { method: string; params: Record<string, unknown> }[] = [];

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ method, params });
    if (method === "Page.getLayoutMetrics") {
      return {
        visualViewport: {
          pageX: 100,
          pageY: 200,
          clientWidth: 800,
          clientHeight: 600,
        },
      } as T;
    }
    if (method === "Page.captureScreenshot") return { data: PNG_BASE64 } as T;
    throw new Error(`unexpected CDP method: ${method}`);
  }
}

function writeSession(root: string, id: string): void {
  const now = new Date().toISOString();
  const record: SessionRecord = {
    id,
    projectRoot: root,
    target: { kind: "url", value: "http://fixture.test" },
    state: "ready",
    createdAt: now,
    updatedAt: now,
    profileDir: "/profile/outside/repository",
    controlPort: 1234,
    cdpPort: 9222,
    token: "local-control-token",
    pid: null,
  };
  writeJsonAtomic(sessionFile(id, root), record);
}

test("viewport and dragged region captures use the visible viewport coordinate space", async () => {
  const page = new FakePage();
  const viewport = await capturePng(page);
  assert.deepEqual({ width: viewport.width, height: viewport.height }, { width: 800, height: 600 });

  const region = await capturePng(page, { x: 10.2, y: 20.4, width: 30.4, height: 40.4 });
  assert.deepEqual({ width: region.width, height: region.height }, { width: 30, height: 40 });
  const screenshot = page.requests.filter((request) => request.method === "Page.captureScreenshot").at(-1);
  assert.deepEqual(screenshot?.params.clip, { x: 110, y: 220, width: 30, height: 40, scale: 1 });

  await assert.rejects(
    capturePng(page, { x: 799, y: 599, width: 10, height: 10 }),
    /capture region is too small/,
  );
});

test("PNG attachments persist dimensions, digest, and bounded bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "lavish-capture-"));
  const id = "capture-session";
  try {
    writeSession(root, id);
    const attachment = saveDataUrl(
      id,
      `data:image/png;base64,${PNG_BASE64}`,
      "viewport",
      "viewport.png",
      root,
    );
    assert.equal(attachment.mime, "image/png");
    assert.equal(attachment.width, 1);
    assert.equal(attachment.height, 1);
    assert.equal(attachment.sha256.length, 64);
    assert.equal(existsSync(attachment.path), true);
    assert.equal(readFileSync(attachment.path).toString("base64"), PNG_BASE64);

    const oversized = "A".repeat(Math.ceil(((10 * 1024 * 1024) + 1) * 4 / 3));
    assert.throws(
      () => saveDataUrl(id, `data:image/png;base64,${oversized}`, "upload", "large.png", root),
      /at most 10485760 bytes/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
