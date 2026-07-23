import { existsSync, mkdirSync } from "node:fs";
import { CdpClient } from "./client.ts";

const BROWSER_NAMES = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "microsoft-edge"];

export interface BrowserHandle {
  process: Bun.Subprocess;
  port: number;
  client: CdpClient;
}

function findBrowser(): string {
  const configured = process.env.LAVISH_BROWSER;
  if (configured) {
    if (!existsSync(configured)) throw new Error(`configured browser does not exist: ${configured}`);
    return configured;
  }
  for (const name of BROWSER_NAMES) {
    const result = Bun.spawnSync(["which", name]);
    if (result.exitCode === 0) {
      const path = result.stdout.toString().trim();
      if (path) return path;
    }
  }
  throw new Error("no Chromium-family browser found; set LAVISH_BROWSER to its executable path");
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("unused") });
  const port = server.port;
  await server.stop(true);
  return port;
}

async function waitForVersion(port: number): Promise<{ webSocketDebuggerUrl: string }> {
  const configuredTimeout = Number(process.env.LAVISH_CDP_TIMEOUT_MS);
  const deadline = Date.now() + (Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 12_000);
  let lastError = "browser did not expose CDP";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return (await response.json()) as { webSocketDebuggerUrl: string };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(50);
  }
  throw new Error(`${lastError}; timed out waiting for CDP on port ${port}`);
}

export async function launchBrowser(targetUrl: string, profileDir: string): Promise<BrowserHandle> {
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const browser = findBrowser();
  const port = await freePort();
  const browserArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--new-window",
  ];
  if (process.env.LAVISH_HEADLESS === "1") {
    browserArgs.unshift("--headless=new", "--no-sandbox", "--disable-gpu");
  }
  const child = Bun.spawn([browser, ...browserArgs, targetUrl], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env },
    detached: true,
  });
  let client: CdpClient | null = null;
  try {
    const version = await waitForVersion(port);
    client = new CdpClient(version.webSocketDebuggerUrl);
    await client.connect();
    return { process: child, port, client };
  } catch (error) {
    client?.close();
    child.kill();
    await child.exited;
    throw error;
  }
}

export async function connectPage(port: number, targetUrl: string): Promise<CdpClient> {
  const configuredTimeout = Number(process.env.LAVISH_CDP_TIMEOUT_MS);
  const deadline = Date.now() + (Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 12_000);
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = (await response.json()) as { type: string; url: string; webSocketDebuggerUrl?: string }[];
    const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl && (!targetUrl || target.url === targetUrl || target.url === "about:blank" || target.url.startsWith(targetUrl)));
    if (page?.webSocketDebuggerUrl) {
      const client = new CdpClient(page.webSocketDebuggerUrl);
      await client.connect();
      return client;
    }
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for browser page: ${targetUrl}`);
}
