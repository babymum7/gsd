import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpClient } from "../src/cdp/client.ts";
import { readFeedback } from "../src/feedback/store.ts";
import { readJson, sessionFile, type SessionRecord } from "../src/paths.ts";

const smokeTest = process.env.LAVISH_E2E === "1" ? test : test.skip;
const CLI = join(import.meta.dir, "../src/cli.ts");
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZKx8AAAAASUVORK5CYII=";

type CliResult = { code: number; stdout: string; stderr: string };
type EvalResult<T> = { result?: { value?: T }; exceptionDetails?: { text?: string } };
interface DomNode {
  nodeId: number;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
}

async function connectSmokePage(port: number): Promise<CdpClient> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await response.json() as { type: string; url: string; webSocketDebuggerUrl?: string }[];
  const target = targets.find((candidate) =>
    candidate.type === "page" &&
    candidate.url.startsWith("http://127.0.0.1:") &&
    candidate.webSocketDebuggerUrl
  );
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`no non-blank Chromium page: ${JSON.stringify(targets.map(({ type, url }) => ({ type, url })))}`);
  }
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return client;
}

async function runCli(args: string[], root: string, stateRoot: string): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: root,
    env: {
      ...process.env,
      LAVISH_PROJECT_ROOT: root,
      LAVISH_HEADLESS: "1",
      XDG_STATE_HOME: stateRoot,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const [out, err, code] = await Promise.all([stdout, stderr, child.exited]);
  return { code, stdout: await out, stderr: await err };
}

function pollWithoutRetry(record: SessionRecord, timeoutMs: number): Promise<{ statusCode: number; body: string }> {
  if (!record.controlPort) throw new Error("session has no control port");
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: record.controlPort,
      path: `/poll?after=0&afterReply=0&timeoutMs=${timeoutMs}`,
      method: "GET",
      headers: { authorization: `Bearer ${record.token}` },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Uint8Array) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function evaluate<T>(page: CdpClient, expression: string): Promise<T> {
  const response = await page.request<EvalResult<T>>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "browser evaluation failed");
  return response.result?.value as T;
}

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, label: string): Promise<T> {
  let latest: T | undefined;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    latest = await read();
    if (predicate(latest)) return latest;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(latest)}`);
}

async function waitForBrowserShutdown(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
    } catch {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for Chromium CDP port ${port} to close`);
}

async function clickSelector(page: CdpClient, selector: string): Promise<void> {
  const point = await evaluate<{ x: number; y: number }>(page, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) throw new Error(${JSON.stringify(`missing ${selector}`)});
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await page.request("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await page.request("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function toolNode(page: CdpClient, selector: string): Promise<DomNode> {
  const match = selector.match(/^\[([^=\]]+)(?:=([^\]]+))?\]$/);
  if (!match) throw new Error(`unsupported tool selector: ${selector}`);
  const [, expectedName, rawValue] = match;
  const expectedValue = rawValue?.replace(/^['"]|['"]$/g, "");
  await page.request("DOM.enable");
  const { root } = await page.request<{ root: DomNode }>("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  const visit = (node: DomNode): DomNode | null => {
    const attributes = node.attributes ?? [];
    for (let index = 0; index < attributes.length; index += 2) {
      if (attributes[index] === expectedName && (expectedValue === undefined || attributes[index + 1] === expectedValue)) {
        return node;
      }
    }
    for (const child of [...(node.shadowRoots ?? []), ...(node.children ?? [])]) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const found = visit(root);
  if (!found) throw new Error(`missing tool control: ${selector}`);
  return found;
}

async function clickTool(page: CdpClient, selector: string): Promise<void> {
  const node = await toolNode(page, selector);
  const { model } = await page.request<{ model: { border: number[] } }>("DOM.getBoxModel", {
    nodeId: node.nodeId,
  });
  const x = (model.border[0] + model.border[2] + model.border[4] + model.border[6]) / 4;
  const y = (model.border[1] + model.border[3] + model.border[5] + model.border[7]) / 4;
  await page.request("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.request("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function toolValue<T>(
  page: CdpClient,
  selector: string,
  functionDeclaration: string,
  value?: string,
): Promise<T> {
  const node = await toolNode(page, selector);
  const { object } = await page.request<{ object: { objectId: string } }>("DOM.resolveNode", {
    nodeId: node.nodeId,
  });
  const response = await page.request<EvalResult<T>>("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration,
    arguments: value === undefined ? [] : [{ value }],
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "tool evaluation failed");
  return response.result?.value as T;
}

async function status(page: CdpClient): Promise<string> {
  return toolValue<string>(page, "[data-status]", "function () { return this.textContent || ''; }");
}

async function setToolValue(page: CdpClient, selector: string, value: string): Promise<void> {
  await toolValue(page, selector, "function (value) { this.value = value; this.dispatchEvent(new Event('input', { bubbles: true })); }", value);
}

async function addUpload(page: CdpClient, path: string): Promise<void> {
  const node = await toolNode(page, "[data-upload]");
  await page.request("DOM.setFileInputFiles", { files: [path], nodeId: node.nodeId });
}

async function addPaste(page: CdpClient): Promise<void> {
  await evaluate(page, `(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_BASE64)}), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  })()`);
}

smokeTest("real Chromium session keeps interaction live and delivers image feedback", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "lavish-smoke-project-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "lavish-smoke-state-"));
  const html = join(root, "fixture.html");
  const upload = join(root, "uploaded.png");
  writeFileSync(upload, Buffer.from(PNG_BASE64, "base64"));
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; min-height: 1400px; font: 16px system-ui; }
    main { padding: 80px 24px; }
    #app { padding: 24px; border: 2px solid #334155; }
    #status { min-height: 24px; }
  </style><main><section id="app"></section><p id="status"></p></main><script>
    window.fixtureState = { clicks: 0, submits: 0 };
    const app = document.querySelector('#app');
    const state = document.querySelector('#status');
    function render() {
      app.innerHTML = '<button id="app-action" type="button">App action</button>'
        + '<form id="app-form"><input id="app-input" aria-label="App input"><button id="app-submit">Submit</button></form>';
      document.querySelector('#app-action').addEventListener('click', () => { window.fixtureState.clicks += 1; state.textContent = 'clicked:' + window.fixtureState.clicks; });
      document.querySelector('#app-form').addEventListener('submit', (event) => { event.preventDefault(); window.fixtureState.submits += 1; state.textContent = 'submitted:' + window.fixtureState.submits; });
    }
    window.rerender = render;
    render();
  </script>`, "utf8");

  let page: CdpClient | null = null;
  let record: SessionRecord | null = null;
  try {
    const opened = await runCli(["prototype", html], root, stateRoot);
    assert.equal(opened.code, 0, opened.stderr || opened.stdout);
    assert.match(opened.stdout, /session:/);
    const id = opened.stdout.match(/\n  id:([a-z0-9-]+)/)?.[1];
    assert.ok(id, "prototype must return a session id");
    record = await waitFor(
      async () => readJson<SessionRecord>(sessionFile(id, root)),
      (value): value is SessionRecord => value?.state === "ready",
      "ready session record",
    );
    assert.ok(record.controlPort);
    assert.ok(record.cdpPort);
    assert.equal(record.target.kind, "file");
    assert.equal(record.sessionType, "prototype");
    assert.equal(record.profileDir.startsWith(stateRoot), true);
    assert.equal(record.profileDir.startsWith(root), false);
    const idlePoll = await pollWithoutRetry(record, 10_500);
    assert.equal(idlePoll.statusCode, 200);
    assert.match(idlePoll.body, /"status":"timeout"/);

    page = await connectSmokePage(record.cdpPort);
    await waitFor(
      () => evaluate<{ url: string; host: boolean }>(
        page!,
        "({ url: location.href, host: Boolean(document.querySelector('[data-lavish-ui]')) })",
      ),
      (value) => value.host,
      "overlay",
    );
    await page.request("Page.reload");
    await waitFor(
      () => evaluate<{ url: string; host: boolean }>(
        page!,
        "({ url: location.href, host: Boolean(document.querySelector('[data-lavish-ui]')) })",
      ),
      (value) => value.host,
      "overlay after navigation",
    );

    await clickSelector(page, "#app-action");
    assert.equal(await evaluate<number>(page, "window.fixtureState.clicks"), 1);
    await evaluate(page, "window.rerender()");
    await clickSelector(page, "#app-action");
    assert.equal(await evaluate<number>(page, "window.fixtureState.clicks"), 2);
    await clickSelector(page, "#app-input");
    await page.request("Input.insertText", { text: "typed through the live page" });
    assert.match(await evaluate<string>(page, "document.querySelector('#app-input').value"), /typed through/);
    await evaluate(page, "window.scrollTo(0, 500)");
    assert.ok(await evaluate<number>(page, "window.scrollY") > 0);
    await clickSelector(page, "#app-submit");
    assert.equal(await evaluate<number>(page, "window.fixtureState.submits"), 1);

    await clickTool(page, "[data-mode=annotate]");
    await waitFor(() => status(page!), (value) => value.includes("Annotate mode"), "annotate mode");
    await clickSelector(page, "#app-action");
    assert.equal(await evaluate<number>(page, "window.fixtureState.clicks"), 2, "annotate click must not activate the app control");
    assert.match(await status(page), /Element ready/);

    await toolValue(page, "[data-more]", "function () { this.open = true; }");
    await toolValue(page, "[data-capture=viewport]", "function () { this.click(); }");
    await waitFor(() => status(page!), (value) => value === "Capture attached", "viewport attachment");
    await toolValue(page, "[data-more]", "function () { this.open = true; }");
    await toolValue(page, "[data-capture=region]", "function () { this.click(); }");
    await waitFor(() => status(page!), (value) => value === "Drag a region in the app", "region capture mode");
    await page.request("Input.dispatchMouseEvent", { type: "mousePressed", x: 24, y: 260, button: "left", clickCount: 1 });
    await page.request("Input.dispatchMouseEvent", { type: "mouseMoved", x: 180, y: 360, button: "left" });
    await page.request("Input.dispatchMouseEvent", { type: "mouseReleased", x: 180, y: 360, button: "left", clickCount: 1 });
    await waitFor(() => status(page!), (value) => value === "Capture attached", "region attachment");

    await addUpload(page, upload);
    await waitFor(
      () => toolValue<number>(page!, "[data-attachments]", "function () { return this.children.length; }"),
      (value) => value === 3,
      "upload attachment",
    );
    await addPaste(page);
    await waitFor(
      () => toolValue<number>(page!, "[data-attachments]", "function () { return this.children.length; }"),
      (value) => value === 4,
      "paste attachment",
    );

    await setToolValue(page, "[data-comment]", "live interaction and capture smoke");
    await clickTool(page, "[data-send]");
    assert.match(await status(page), /Sending queued feedback|Feedback delivered/);
    const feedback = await waitFor(
      async () => readFeedback(record!.id, root),
      (value) => value.deliveries.length === 1 && value.deliveries[0].items[0].attachments.length === 4,
      "ordered feedback with four attachments",
    );
    const deliveredItem = feedback.deliveries[0].items[0];
    assert.equal(deliveredItem.comment, "live interaction and capture smoke");
    assert.equal(deliveredItem.attachments.length, 4);
    assert.ok(deliveredItem.anchor);

    const sessions = await runCli(["sessions"], root, stateRoot);
    assert.equal(sessions.code, 0, sessions.stderr);
    assert.match(sessions.stdout, new RegExp(id));
    const delivered = await runCli(["feedback", id], root, stateRoot);
    assert.equal(delivered.code, 0, delivered.stderr);
    assert.match(delivered.stdout, /attachments/);
    assert.match(delivered.stdout, /\.png/);
    assert.doesNotMatch(delivered.stdout, /data:image\/png;base64/);
    const ended = await runCli(["end", id], root, stateRoot);
    assert.equal(ended.code, 0, ended.stderr);
    assert.match(ended.stdout, /state:ended/);
    record = readJson<SessionRecord>(sessionFile(id, root));
    assert.equal(record?.state, "ended");
  } finally {
    page?.close();
    if (record?.state === "ready" && record.controlPort) {
      await fetch(`http://127.0.0.1:${record.controlPort}/end`, {
        method: "POST",
        headers: { authorization: `Bearer ${record.token}` },
      }).catch(() => {});
    }
    if (record?.cdpPort) await waitForBrowserShutdown(record.cdpPort);
    rmSync(root, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

smokeTest("CLI opens an existing URL and ends the session", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "lavish-url-project-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "lavish-url-state-"));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("<!doctype html><title>Lavish URL smoke</title><main>live URL</main>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  });
  let record: SessionRecord | null = null;
  let page: CdpClient | null = null;
  try {
    const targetUrl = `http://127.0.0.1:${server.port}/`;
    const opened = await runCli(["app", targetUrl], root, stateRoot);
    assert.equal(opened.code, 0, opened.stderr || opened.stdout);
    const id = opened.stdout.match(/\n  id:([a-z0-9-]+)/)?.[1];
    assert.ok(id, "app must return a session id");
    record = await waitFor(
      async () => readJson<SessionRecord>(sessionFile(id, root)),
      (value): value is SessionRecord => value?.state === "ready",
      "URL session",
    );
    assert.equal(record.target.kind, "url");
    assert.equal(record.sessionType, "app");
    page = await connectSmokePage(record.cdpPort);
    const observed = await waitFor(
      () => evaluate<{ url: string; body: string }>(page!, "({ url: location.href, body: document.body?.textContent || '' })"),
      (value) => value.url === targetUrl && value.body.includes("live URL"),
      "URL content",
    );
    assert.equal(observed.url, targetUrl);
    const ended = await runCli(["end", id], root, stateRoot);
    assert.equal(ended.code, 0, ended.stderr);
    assert.match(ended.stdout, /state:ended/);
  } finally {
    page?.close();
    if (record?.state === "ready" && record.controlPort) {
      await fetch(`http://127.0.0.1:${record.controlPort}/end`, {
        method: "POST",
        headers: { authorization: `Bearer ${record.token}` },
      }).catch(() => {});
    }
    if (record?.cdpPort) await waitForBrowserShutdown(record.cdpPort);
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});
