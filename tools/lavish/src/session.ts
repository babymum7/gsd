import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { saveDataUrl, type Attachment } from "./attachments.ts";
import {
  appendAgentReply,
  queueFeedback,
  readDrafts,
  readFeedback,
  removeQueuedFeedback,
  sendFeedback,
  type AgentReply,
} from "./feedback/store.ts";
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
import { createOverlaySource } from "./injected/overlay.ts";
import { launchBrowser, connectPage, type BrowserHandle } from "./cdp/browser.ts";
import { capturePng } from "./cdp/page.ts";
import type { CdpClient } from "./cdp/client.ts";

interface HtmlServer {
  url: string;
  stop: (closeActiveConnections?: boolean) => void;
}

export type AgentPresence = "listening" | "working";

interface FeedbackControlCallbacks {
  onEnd?: () => void | Promise<void>;
  onPresence?: (presence: AgentPresence) => void | Promise<void>;
  onReply?: (reply: AgentReply) => void | Promise<void>;
}

export interface FeedbackControlServer {
  port: number;
  ended: Promise<void>;
  notifyDelivery: () => void;
  stop: (closeActiveConnections?: boolean) => void;
}

export interface OverlayPage {
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on?(
    method: string,
    handler: (params: Record<string, unknown>) => void,
  ): (() => void) | void;
}

export interface InstalledOverlay {
  bindingName: string;
  worldName: string;
  source: string;
  evaluate: (expression: string) => Promise<void>;
}

interface OverlayInstallOptions {
  bindingName?: string;
  worldName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface RuntimeEvaluateResult {
  result?: { value?: unknown };
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
  };
}

type WakeReason = "delivery" | "ended" | "timeout";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function authorized(request: Request, token: string): boolean {
  return request.headers.get("authorization") === `Bearer ${token}`;
}

function parseNonNegativeInteger(value: string | null, fallback: number, name: string): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
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
  return { url: `http://127.0.0.1:${server.port}/`, stop: (close) => void server.stop(close) };
}

async function evaluate(
  page: OverlayPage,
  expression: string,
  contextId: number,
): Promise<void> {
  const result = await page.request<RuntimeEvaluateResult>("Runtime.evaluate", {
    expression,
    contextId,
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

async function notifyPage(overlay: InstalledOverlay, callback: string, value: unknown): Promise<void> {
  await overlay.evaluate(`window[${JSON.stringify(callback)}]?.(${JSON.stringify(value)})`);
}

export async function installOverlay(
  page: OverlayPage,
  options: OverlayInstallOptions = {},
): Promise<InstalledOverlay> {
  const suffix = randomUUID().replaceAll("-", "");
  const bindingName = options.bindingName ?? `lavish_${suffix}`;
  const worldName = options.worldName ?? `lavish-editor-${suffix}`;
  const source = createOverlaySource(bindingName);
  let contextId: number | null = null;
  let mainFrameId: string | null = null;
  page.on?.("Runtime.executionContextCreated", (params) => {
    const context = params.context;
    if (!isRecord(context) || context.name !== worldName || typeof context.id !== "number") return;
    const auxData = context.auxData;
    if (!isRecord(auxData) || auxData.frameId !== mainFrameId) return;
    contextId = context.id;
  });
  await page.request("Page.enable");
  await page.request("Runtime.enable");
  await page.request("Runtime.addBinding", { name: bindingName, executionContextName: worldName });
  await page.request("Page.addScriptToEvaluateOnNewDocument", { source, worldName });
  const frameTree = await page.request<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
  mainFrameId = frameTree.frameTree.frame.id;
  const isolatedWorld = await page.request<{ executionContextId: number }>("Page.createIsolatedWorld", {
    frameId: mainFrameId,
    worldName,
    grantUniveralAccess: false,
  });
  contextId = isolatedWorld.executionContextId;
  const installed: InstalledOverlay = {
    bindingName,
    worldName,
    source,
    async evaluate(expression) {
      if (contextId === null) throw new Error("Lavish isolated world is unavailable");
      await evaluate(page, expression, contextId);
    },
  };
  await installed.evaluate(source);
  return installed;
}

async function navigateToTarget(
  page: CdpClient,
  overlay: InstalledOverlay,
  browserPort: number,
  url: string,
): Promise<void> {
  const navigation = await page.request<{ errorText?: string }>("Page.navigate", { url });
  if (navigation.errorText) throw new Error(`browser navigation failed: ${navigation.errorText}`);

  const configuredTimeout = Number(process.env.LAVISH_CDP_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 12_000;
  const deadline = Date.now() + timeoutMs;
  let lastError = "target document is not ready";
  while (Date.now() < deadline) {
    try {
      const evaluated = await page.request<RuntimeEvaluateResult>("Runtime.evaluate", {
        expression: "({ href: location.href, readyState: document.readyState })",
        returnByValue: true,
      });
      const state = evaluated.result?.value;
      if (
        !evaluated.exceptionDetails &&
        isRecord(state) &&
        typeof state.href === "string" &&
        state.href !== "" &&
        state.href !== "about:blank" &&
        typeof state.readyState === "string" &&
        state.readyState !== "loading"
      ) {
        await overlay.evaluate("void 0");
        const response = await fetch(`http://127.0.0.1:${browserPort}/json/list`);
        if (!response.ok) throw new Error(`browser target discovery failed: ${response.status}`);
        const targets = await response.json() as {
          type: string;
          url: string;
          webSocketDebuggerUrl?: string;
        }[];
        if (targets.some((target) =>
          target.type === "page" &&
          target.url === state.href &&
          Boolean(target.webSocketDebuggerUrl)
        )) {
          return;
        }
        lastError = "target document is not discoverable through CDP";
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(50);
  }
  throw new Error(`${lastError}; timed out waiting for target document`);
}

function writeRecord(record: SessionRecord, root: string): void {
  record.updatedAt = new Date().toISOString();
  writeJsonAtomic(sessionFile(record.id, root), record);
}

export function startFeedbackControlServer(
  record: SessionRecord,
  root = projectRoot(),
  callbacks: FeedbackControlCallbacks = {},
): FeedbackControlServer {
  const ended = Promise.withResolvers<void>();
  const waiters = new Set<(reason: WakeReason) => void>();
  let stopped = false;
  let server: ReturnType<typeof Bun.serve>;

  const wake = (reason: WakeReason) => {
    for (const resolveWaiter of waiters) resolveWaiter(reason);
    waiters.clear();
  };

  const stop = (closeActiveConnections = true) => {
    if (stopped) return;
    stopped = true;
    wake("ended");
    void server.stop(closeActiveConnections);
    ended.resolve();
  };

  const publishPresence = (presence: AgentPresence) => {
    try {
      const pending = callbacks.onPresence?.(presence);
      if (pending) void pending.catch(() => {});
    } catch {
      // Browser presentation is best-effort; it cannot break feedback transport.
    }
  };

  const publishReply = (reply: AgentReply) => {
    try {
      const pending = callbacks.onReply?.(reply);
      if (pending) void pending.catch(() => {});
    } catch {
      // The reply is already persisted even if its browser context was replaced.
    }
  };

  const waitForFeedback = async (after: number, afterReply: number, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (!stopped) {
      const current = readFeedback(record.id, root, after, afterReply);
      if (current.deliveries.length > 0) return { status: "feedback", ...current };
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { status: "timeout", ...current };

      const gate = Promise.withResolvers<WakeReason>();
      waiters.add(gate.resolve);
      const persisted = readFeedback(record.id, root, after, afterReply);
      if (persisted.deliveries.length > 0) {
        waiters.delete(gate.resolve);
        return { status: "feedback", ...persisted };
      }
      const timer = setTimeout(() => gate.resolve("timeout"), remaining);
      const reason = await gate.promise;
      clearTimeout(timer);
      waiters.delete(gate.resolve);
      const settled = readFeedback(record.id, root, after, afterReply);
      if (settled.deliveries.length > 0) return { status: "feedback", ...settled };
      if (reason === "ended") return { status: "ended", ...settled };
      if (reason === "timeout") return { status: "timeout", ...settled };
    }
    return { status: "ended", ...readFeedback(record.id, root, after, afterReply) };
  };

  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, bunServer) {
      if (!authorized(request, record.token)) return jsonResponse({ error: "unauthorized" }, 401);
      const url = new URL(request.url);
      try {
        if (url.pathname === "/status" && request.method === "GET") return jsonResponse(record);
        if (url.pathname === "/feedback" && request.method === "GET") {
          const after = parseNonNegativeInteger(url.searchParams.get("after"), 0, "feedback cursor");
          const afterReply = parseNonNegativeInteger(url.searchParams.get("afterReply"), 0, "reply cursor");
          return jsonResponse(readFeedback(record.id, root, after, afterReply));
        }
        if (url.pathname === "/poll" && request.method === "GET") {
          bunServer.timeout(request, 0);
          const after = parseNonNegativeInteger(url.searchParams.get("after"), 0, "feedback cursor");
          const afterReply = parseNonNegativeInteger(url.searchParams.get("afterReply"), 0, "reply cursor");
          const timeoutMs = parseNonNegativeInteger(url.searchParams.get("timeoutMs"), 300_000, "poll timeout");
          if (timeoutMs < 10 || timeoutMs > 300_000) {
            return jsonResponse({ error: "poll timeout must be between 10 and 300000 milliseconds" }, 400);
          }
          const available = readFeedback(record.id, root, after, afterReply);
          if (available.deliveries.length > 0) {
            publishPresence("working");
            return jsonResponse({ status: "feedback", ...available });
          }
          publishPresence("listening");
          const result = await waitForFeedback(after, afterReply, timeoutMs);
          if (result.status === "feedback") publishPresence("working");
          return jsonResponse(result);
        }
        if (url.pathname === "/reply" && request.method === "POST") {
          const body = await request.json() as { message?: unknown };
          const reply = appendAgentReply(record.id, typeof body.message === "string" ? body.message : "", root);
          publishReply(reply);
          return jsonResponse({ status: "recorded", reply, replyCursor: reply.id });
        }
        if (url.pathname === "/end" && request.method === "POST") {
          record.state = "ended";
          writeRecord(record, root);
          wake("ended");
          try {
            await callbacks.onEnd?.();
          } finally {
            stop(false);
          }
          return jsonResponse(record);
        }
        return jsonResponse({ error: "not_found" }, 404);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    },
  });

  return {
    port: server.port,
    ended: ended.promise,
    notifyDelivery() {
      publishPresence("working");
      wake("delivery");
    },
    stop,
  };
}

async function deliverAttachment(overlay: InstalledOverlay, attachment: Attachment): Promise<void> {
  await notifyPage(overlay, "__lavishAttachmentResult", attachment);
}

async function deliverError(overlay: InstalledOverlay, message: string): Promise<void> {
  await notifyPage(overlay, "__lavishError", message);
}

function selectAttachments(ids: string[], attachments: Map<string, Attachment>): Attachment[] {
  const selected = ids.map((id) => attachments.get(id));
  if (selected.some((attachment) => !attachment)) throw new Error("feedback references an unknown attachment");
  return selected as Attachment[];
}

async function handleBinding(
  page: CdpClient,
  overlay: InstalledOverlay,
  record: SessionRecord,
  payload: string,
  attachments: Map<string, Attachment>,
  root: string,
  notifyDelivery: () => void,
): Promise<void> {
  try {
    const message = normalizeBindingMessage(payload);
    if (message.type === "ready") {
      await notifyPage(overlay, "__lavishSessionReady", {
        drafts: readDrafts(record.id, root),
        history: readFeedback(record.id, root),
      });
      return;
    }
    if (message.type === "attachment") {
      const attachment = saveDataUrl(record.id, message.dataUrl, message.source, message.name, root);
      attachments.set(attachment.id, attachment);
      await deliverAttachment(overlay, attachment);
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
      await deliverAttachment(overlay, attachment);
      return;
    }
    if (message.type === "remove") {
      const drafts = removeQueuedFeedback(record.id, message.draftId, root);
      await notifyPage(overlay, "__lavishDraftsUpdated", drafts);
      return;
    }

    const selected = selectAttachments(message.attachmentIds, attachments);
    if (message.type === "queue") {
      const drafts = queueFeedback(record.id, {
        draftId: message.draftId,
        comment: message.comment,
        anchor: message.anchor,
        attachments: selected,
      }, root);
      await notifyPage(overlay, "__lavishDraftsUpdated", drafts);
      return;
    }

    const before = readFeedback(record.id, root).cursor;
    const hasCurrent = Boolean(message.comment || selected.length > 0);
    const delivery = sendFeedback(record.id, {
      deliveryId: message.deliveryId,
      current: hasCurrent
        ? {
            draftId: message.draftId,
            comment: message.comment,
            anchor: message.anchor,
            attachments: selected,
          }
        : null,
    }, root);
    if (delivery.cursor > before) notifyDelivery();
    await notifyPage(overlay, "__lavishFeedbackSent", { delivery, drafts: [] });
  } catch (error) {
    await deliverError(overlay, error instanceof Error ? error.message : String(error));
  }
}

function targetUrl(record: SessionRecord): { fileServer: HtmlServer | null; url: string } {
  if (record.sessionType === "prototype" && record.target.kind === "file") {
    const fileServer = serveHtml(record.target.value);
    return { fileServer, url: fileServer.url };
  }
  if (record.sessionType === "app" && record.target.kind === "url") {
    return { fileServer: null, url: record.target.value };
  }
  throw new Error(`session type ${record.sessionType} does not match target ${record.target.kind}`);
}

export async function runDaemon(id: string, root = projectRoot()): Promise<void> {
  const record = readJson<SessionRecord>(sessionFile(id, root));
  if (!record) throw new Error(`unknown session: ${id}`);
  ensureRuntimeDirs(root);
  const profileDir = projectProfileRoot(root);
  let fileServer: HtmlServer | null = null;
  let browser: BrowserHandle | null = null;
  let page: CdpClient | null = null;
  let control: FeedbackControlServer | null = null;
  try {
    const target = targetUrl(record);
    fileServer = target.fileServer;
    browser = await launchBrowser("about:blank", profileDir);
    page = await connectPage(browser.port, "about:blank");
    const attachments = new Map<string, Attachment>();
    const overlay = await installOverlay(page);
    page.on("Runtime.bindingCalled", (params) => {
      if (params.name === overlay.bindingName && typeof params.payload === "string") {
        void handleBinding(page!, overlay, record, params.payload, attachments, root, () => control?.notifyDelivery());
      }
    });
    await navigateToTarget(page, overlay, browser.port, target.url);
    control = startFeedbackControlServer(record, root, {
      onPresence: (presence) => notifyPage(overlay, "__lavishPresence", presence),
      onReply: (reply) => notifyPage(overlay, "__lavishAgentReply", reply),
      async onEnd() {
        page?.close();
        browser?.client.close();
        if (browser) {
          browser.process.kill();
          await browser.process.exited;
        }
        fileServer?.stop(true);
      },
    });
    record.profileDir = profileDir;
    record.controlPort = control.port;
    record.cdpPort = browser.port;
    record.pid = browser.process.pid;
    record.state = "ready";
    writeRecord(record, root);
    await control.ended;
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

export function daemonEntrypoint(main = Bun.main): string {
  return resolve(main);
}

export async function launchDaemon(record: SessionRecord, directory: string): Promise<SessionRecord> {
  const child = Bun.spawn([process.execPath, daemonEntrypoint(), "daemon", "--id", record.id], {
    cwd: record.projectRoot,
    env: { ...process.env, LAVISH_PROJECT_ROOT: record.projectRoot },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });
  child.unref();
  record.pid = child.pid;
  writeJsonAtomic(sessionFile(record.id, record.projectRoot), record);
  const configuredTimeout = Number(process.env.LAVISH_DAEMON_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 100
    ? Math.min(configuredTimeout, 60_000)
    : 15_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = readJson<SessionRecord>(sessionFile(record.id, record.projectRoot));
    if (current?.state === "ready") return current;
    if (current?.state === "failed") throw new Error(current.error || "Lavish session failed to start");
    await Bun.sleep(50);
  }
  child.kill();
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
