import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

async function clickTool(page: CdpClient, selector: string): Promise<void> {
  await evaluate(page, `document.querySelector("[data-lavish-ui]")?.shadowRoot?.querySelector(${JSON.stringify(selector)})?.click()`);
}

async function status(page: CdpClient): Promise<string> {
  return evaluate<string>(page, `document.querySelector("[data-lavish-ui]")?.shadowRoot?.querySelector("[data-status]")?.textContent || ""`);
}

async function addUpload(page: CdpClient): Promise<void> {
  await evaluate(page, `(() => {
    const input = document.querySelector("[data-lavish-ui]")?.shadowRoot?.querySelector("[data-upload]");
    if (!(input instanceof HTMLInputElement)) throw new Error("missing upload input");
    const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_BASE64)}), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "uploaded.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
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
    const opened = await runCli(["open", "--file", html], root, stateRoot);
    assert.equal(opened.code, 0, opened.stderr);
    assert.match(opened.stdout, /session:/);
    const id = opened.stdout.match(/\n  id:([a-z0-9-]+)/)?.[1];
    assert.ok(id, "open must return a session id");
    record = await waitFor(
      async () => readJson<SessionRecord>(sessionFile(id, root)),
      (value): value is SessionRecord => value?.state === "ready",
      "ready session record",
    );
    assert.ok(record.controlPort);
    assert.ok(record.cdpPort);
    assert.equal(record.target.kind, "file");
    assert.equal(record.profileDir.startsWith(stateRoot), true);
    assert.equal(record.profileDir.startsWith(root), false);

    page = await connectSmokePage(record.cdpPort);
    await waitFor(
      () => evaluate<{ url: string; installed: boolean; host: boolean; install: string }>(page!, "({ url: location.href, installed: Boolean(window.__lavishInstalled), host: Boolean(document.querySelector('[data-lavish-ui]')), install: typeof window.__lavishInstall })"),
      (value) => value.installed && value.host,
      "overlay",
    );
    await page.request("Page.reload");
    await waitFor(
      () => evaluate<{ url: string; installed: boolean; host: boolean; install: string }>(page!, "({ url: location.href, installed: Boolean(window.__lavishInstalled), host: Boolean(document.querySelector('[data-lavish-ui]')), install: typeof window.__lavishInstall })"),
      (value) => value.installed && value.host,
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
    assert.match(await status(page), /Element selected/);

    await clickTool(page, "[data-capture=viewport]");
    await waitFor(() => status(page!), (value) => value === "Capture attached", "viewport attachment");
    await clickTool(page, "[data-capture=region]");
    await waitFor(() => status(page!), (value) => value === "Drag a region in the app", "region capture mode");
    await page.request("Input.dispatchMouseEvent", { type: "mousePressed", x: 24, y: 260, button: "left", clickCount: 1 });
    await page.request("Input.dispatchMouseEvent", { type: "mouseMoved", x: 180, y: 360, button: "left" });
    await page.request("Input.dispatchMouseEvent", { type: "mouseReleased", x: 180, y: 360, button: "left", clickCount: 1 });
    await waitFor(() => status(page!), (value) => value === "Capture attached", "region attachment");

    await evaluate(page, "document.querySelector('[data-lavish-ui]').shadowRoot.querySelector('[data-status]').textContent = 'Awaiting upload'");
    await addUpload(page);
    await waitFor(() => status(page!), (value) => value === "Image attached", "upload attachment");
    await evaluate(page, "document.querySelector('[data-lavish-ui]').shadowRoot.querySelector('[data-status]').textContent = 'Awaiting paste'");
    await addPaste(page);
    await waitFor(() => status(page!), (value) => value === "Image attached", "paste attachment");

    await evaluate(page, "document.querySelector('[data-lavish-ui]').shadowRoot.querySelector('[data-comment]').value = 'live interaction and capture smoke'");
    await clickTool(page, "[data-submit]");
    assert.match(await status(page), /Sending feedback|Feedback sent/);
    const feedback = await waitFor(
      async () => readFeedback(record!.id, root),
      (value) => value.items.length === 1 && value.items[0].attachments.length === 4,
      "ordered feedback with four attachments",
    );
    assert.equal(feedback.items[0].comment, "live interaction and capture smoke");
    assert.equal(feedback.items[0].attachments.length, 4);
    assert.ok(feedback.items[0].anchor);

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
    if (record?.state === "ready" && record.controlPort) {
      await fetch(`http://127.0.0.1:${record.controlPort}/end`, {
        method: "POST",
        headers: { authorization: `Bearer ${record.token}` },
      }).catch(() => {});
    }
    page?.close();
    await Bun.sleep(200);
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
    const opened = await runCli(["open", "--url", targetUrl], root, stateRoot);
    assert.equal(opened.code, 0, opened.stderr);
    const id = opened.stdout.match(/\n  id:([a-z0-9-]+)/)?.[1];
    assert.ok(id, "URL open must return a session id");
    record = await waitFor(
      async () => readJson<SessionRecord>(sessionFile(id, root)),
      (value): value is SessionRecord => value?.state === "ready",
      "URL session",
    );
    assert.equal(record.target.kind, "url");
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
    if (record?.state === "ready" && record.controlPort) {
      await fetch(`http://127.0.0.1:${record.controlPort}/end`, {
        method: "POST",
        headers: { authorization: `Bearer ${record.token}` },
      }).catch(() => {});
    }
    page?.close();
    server.stop(true);
    await Bun.sleep(200);
    rmSync(root, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});
