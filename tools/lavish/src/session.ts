import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { saveDataUrl, type Attachment } from "./attachments.ts";
import { appendFeedback, readFeedback } from "./feedback/store.ts";
import { normalizeBindingMessage } from "./feedback/protocol.ts";
import {
  ensureRuntimeDirs,
  projectProfileRoot,
  projectRoot,
  readJson,
  sessionFile,
  writeJsonAtomic,
  type SessionRecord,
} from "./paths.ts";
import { OVERLAY_SOURCE } from "./injected/overlay.ts";
import { launchBrowser, connectPage, type BrowserHandle } from "./cdp/browser.ts";
import { capturePng } from "./cdp/page.ts";
import type { CdpClient } from "./cdp/client.ts";

interface HtmlServer {
  url: string;
  stop: (closeActiveConnections?: boolean) => void;
}

interface ControlServer {
  port: number;
  stop: (closeActiveConnections?: boolean) => void;
}

export interface OverlayPage {
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

interface RuntimeEvaluateResult {
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function authorized(request: Request, token: string): boolean {
  return request.headers.get("authorization") === `Bearer ${token}`;
}

function serveHtml(file: string): HtmlServer {
  const absolute = resolve(file);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`HTML target must be a regular file: ${absolute}`);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response(Bun.file(absolute), { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/`, stop: (close) => server.stop(close) };
}

async function evaluate(page: OverlayPage, expression: string): Promise<void> {
  const result = await page.request<RuntimeEvaluateResult>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "browser evaluation failed",
    );
  }
}

export async function installOverlay(page: OverlayPage): Promise<void> {
  await page.request("Page.enable");
  await page.request("Runtime.enable");
  await page.request("Runtime.addBinding", { name: "lavishSend" });
  await page.request("Page.addScriptToEvaluateOnNewDocument", { source: OVERLAY_SOURCE });
  await evaluate(page, OVERLAY_SOURCE);
}

function writeRecord(record: SessionRecord, root: string): void {
  record.updatedAt = new Date().toISOString();
  writeJsonAtomic(sessionFile(record.id, root), record);
}

async function deliverAttachment(page: CdpClient, attachment: Attachment): Promise<void> {
  await evaluate(page, `window.__lavishAttachmentResult?.(${JSON.stringify(attachment)})`);
}

async function deliverError(page: CdpClient, message: string): Promise<void> {
  await evaluate(page, `window.__lavishError?.(${JSON.stringify(message)})`);
}

async function handleBinding(
  page: CdpClient,
  record: SessionRecord,
  payload: string,
  attachments: Map<string, Attachment>,
  root: string,
): Promise<void> {
  try {
    const message = normalizeBindingMessage(payload);
    if (message.type === "ready") return;
    if (message.type === "attachment") {
      const attachment = saveDataUrl(
        record.id,
        message.dataUrl,
        message.source,
        message.name,
        root,
      );
      attachments.set(attachment.id, attachment);
      await deliverAttachment(page, attachment);
      return;
    }
    if (message.type === "capture") {
      const capture = await capturePng(page, message.mode === "region" ? message.region : undefined);
      const attachment = saveDataUrl(
        record.id,
        capture.dataUrl,
        message.mode,
        `${record.id}-${message.mode}.png`,
        root,
      );
      attachments.set(attachment.id, attachment);
      await deliverAttachment(page, attachment);
      return;
    }
    const selected = message.attachmentIds.flatMap((id) => {
      const attachment = attachments.get(id);
      return attachment ? [attachment] : [];
    });
    appendFeedback(
      record.id,
      {
        deliveryId: message.deliveryId,
        comment: message.comment,
        anchor: message.anchor,
        attachments: selected,
      },
      root,
    );
    await evaluate(page, "window.__lavishFeedbackSent?.()");
  } catch (error) {
    await deliverError(page, error instanceof Error ? error.message : String(error));
  }
}

function controlServer(
  record: SessionRecord,
  page: CdpClient,
  browser: BrowserHandle,
  root: string,
  fileServer: HtmlServer | null,
): ControlServer {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (!authorized(request, record.token)) return jsonResponse({ error: "unauthorized" }, 401);
      const url = new URL(request.url);
      if (url.pathname === "/status" && request.method === "GET") return jsonResponse(record);
      if (url.pathname === "/feedback" && request.method === "GET") {
        const after = Number(url.searchParams.get("after") || 0);
        return jsonResponse(readFeedback(record.id, root, Number.isInteger(after) && after >= 0 ? after : 0));
      }
      if (url.pathname === "/end" && request.method === "POST") {
        record.state = "ended";
        writeRecord(record, root);
        setTimeout(() => {
          page.close();
          browser.client.close();
          browser.process.kill();
          fileServer?.stop(true);
          server.stop(true);
        }, 0);
        return jsonResponse({ id: record.id, state: "ended" });
      }
      return jsonResponse({ error: "not_found" }, 404);
    },
  });
  return server;
}

export async function runDaemon(id: string, root = projectRoot()): Promise<void> {
  const record = readJson<SessionRecord>(sessionFile(id, root));
  if (!record) throw new Error(`unknown session: ${id}`);
  ensureRuntimeDirs(root);
  const profileDir = projectProfileRoot(root);
  const fileServer = record.target.kind === "file" ? serveHtml(record.target.value) : null;
  const targetUrl = fileServer?.url || record.target.value;
  let browser: BrowserHandle | null = null;
  let page: CdpClient | null = null;
  let control: ControlServer | null = null;
  try {
    browser = await launchBrowser(targetUrl, profileDir);
    page = await connectPage(browser.port, targetUrl);
    const attachments = new Map<string, Attachment>();
    await installOverlay(page);
    page.on("Runtime.bindingCalled", (params) => {
      if (params.name === "lavishSend" && typeof params.payload === "string") {
        void handleBinding(page!, record, params.payload, attachments, root);
      }
    });
    await page.request("Page.navigate", { url: targetUrl });
    await evaluate(page, OVERLAY_SOURCE);
    control = controlServer(record, page, browser, root, fileServer);
    record.profileDir = profileDir;
    record.controlPort = control.port;
    record.cdpPort = browser.port;
    record.pid = browser.process.pid;
    record.state = "ready";
    writeRecord(record, root);
    const { promise } = Promise.withResolvers<void>();
    await promise;
  } catch (error) {
    control?.stop(true);
    page?.close();
    if (browser) {
      browser.client.close();
      browser.process.kill();
      await browser.process.exited;
    }
    fileServer?.stop(true);
    record.state = "failed";
    record.error = error instanceof Error ? error.message : String(error);
    writeRecord(record, root);
    throw error;
  }
}

export async function launchDaemon(record: SessionRecord, directory: string): Promise<SessionRecord> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts"), "daemon", "--id", record.id], {
    cwd: record.projectRoot,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });
  child.unref();
  record.pid = child.pid;
  writeJsonAtomic(sessionFile(record.id, record.projectRoot), record);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = readJson<SessionRecord>(sessionFile(record.id, record.projectRoot));
    if (current?.state === "ready") return current;
    if (current?.state === "failed") throw new Error(current.error || "Lavish session failed to start");
    await Bun.sleep(50);
  }
  throw new Error(`timed out starting Lavish session ${record.id} in ${directory}`);
}

export async function stopSession(record: SessionRecord): Promise<SessionRecord> {
  if (!record.controlPort) {
    record.state = "ended";
    writeRecord(record, record.projectRoot);
    return record;
  }
  const response = await fetch(`http://127.0.0.1:${record.controlPort}/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${record.token}` },
  });
  if (!response.ok) throw new Error(`Lavish session refused end: ${response.status}`);
  return (await response.json()) as SessionRecord;
}
