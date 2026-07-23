import { existsSync, mkdirSync } from "node:fs";
import { CdpClient } from "./client.ts";

const BROWSER_NAMES = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "microsoft-edge"];

const DESKTOP_ENVIRONMENT_KEYS = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
] as const;

function validDesktopValue(key: (typeof DESKTOP_ENVIRONMENT_KEYS)[number], value: string): boolean {
  if (!value || value.length > 4096 || /[\0\r\n]/.test(value)) return false;
  if (key === "DISPLAY") return /^(?:[A-Za-z0-9._-]+)?:\d+(?:\.\d+)?$/.test(value);
  if (key === "WAYLAND_DISPLAY") return /^wayland-[A-Za-z0-9._-]+$/.test(value);
  if (key === "DBUS_SESSION_BUS_ADDRESS") {
    return /^unix:(?:path|abstract)=[^;\s]+(?:,[^;\s]+)*(?:;unix:(?:path|abstract)=[^;\s]+(?:,[^;\s]+)*)*$/.test(value);
  }
  return value.startsWith("/") && !/\s/.test(value);
}

export function resolveBrowserEnvironment(
  baseEnvironment: Record<string, string | undefined>,
  platform = process.platform,
  systemdEnvironmentText = "",
): Record<string, string | undefined> {
  const resolved = { ...baseEnvironment };
  if (platform !== "linux" || resolved.DISPLAY || resolved.WAYLAND_DISPLAY) return resolved;
  for (const line of systemdEnvironmentText.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator) as (typeof DESKTOP_ENVIRONMENT_KEYS)[number];
    if (!DESKTOP_ENVIRONMENT_KEYS.includes(key)) continue;
    const value = line.slice(separator + 1);
    if (validDesktopValue(key, value)) resolved[key] = value;
  }
  return resolved;
}

function browserEnvironment(): Record<string, string | undefined> {
  if (process.platform !== "linux" || process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    return { ...process.env };
  }
  const result = Bun.spawnSync(["systemctl", "--user", "show-environment"], {
    env: { ...process.env },
  });
  const systemdEnvironmentText = result.exitCode === 0 ? result.stdout.toString() : "";
  return resolveBrowserEnvironment(process.env, process.platform, systemdEnvironmentText);
}

function spawnEnvironment(environment: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function findBrowser(environment: Record<string, string | undefined>): string {
  const configured = environment.LAVISH_BROWSER;
  if (configured) {
    if (!existsSync(configured)) throw new Error(`configured browser does not exist: ${configured}`);
    return configured;
  }
  for (const name of BROWSER_NAMES) {
    const result = Bun.spawnSync(["which", name], { env: spawnEnvironment(environment) });
    if (result.exitCode === 0) {
      const path = result.stdout.toString().trim();
      if (path) return path;
    }
  }
  throw new Error("no Chromium-family browser found; set LAVISH_BROWSER to its executable path");
}

export interface BrowserHandle {
  process: Bun.Subprocess;
  port: number;
  client: CdpClient;
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
  const environment = browserEnvironment();
  const browser = findBrowser(environment);
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
    env: spawnEnvironment(environment),
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
