import { test } from "bun:test";
import assert from "node:assert/strict";
import { installOverlay, type OverlayPage } from "../src/session.ts";
import { OVERLAY_SOURCE, overlayEventAction } from "../src/injected/overlay.ts";
import {
  createBoundedAnchor,
  SELECTOR_RUNTIME,
  type AnchorElement,
} from "../src/injected/selector.ts";

interface TestElement extends AnchorElement {
  children: TestElement[];
  attributes: Record<string, string>;
}

function makeElement(tagName: string, options: { id?: string; text?: string; attributes?: Record<string, string> } = {}): TestElement {
  return {
    tagName: tagName.toUpperCase(),
    id: options.id ?? "",
    parentElement: null,
    children: [],
    attributes: options.attributes ?? {},
    innerText: options.text ?? "",
    textContent: options.text ?? "",
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
  };
}

function append(parent: TestElement, child: TestElement): TestElement {
  parent.children.push(child);
  child.parentElement = parent;
  return child;
}

test("Interact passes app events while Annotate and region modes intercept intentionally", () => {
  assert.equal(overlayEventAction("interact", false, false), "pass");
  assert.equal(overlayEventAction("annotate", false, false), "annotate");
  assert.equal(overlayEventAction("interact", false, true), "region");
  assert.equal(overlayEventAction("annotate", true, true), "pass");
});

test("DOM anchors are bounded, descriptive, and serializable into the injected runtime", () => {
  const root = makeElement("html");
  let parent = root;
  for (let index = 0; index < 8; index += 1) parent = append(parent, makeElement("div"));
  const sibling = append(parent, makeElement("button", { text: "other" }));
  const target = append(parent, makeElement("button", {
    id: "save:primary",
    text: ` Save   changes ${"x".repeat(300)}`,
    attributes: { role: "button", "aria-label": "Save settings" },
  }));

  const anchor = createBoundedAnchor(target, "http://fixture.test/settings");
  assert.equal(anchor.tag, "button");
  assert.equal(anchor.role, "button");
  assert.equal(anchor.name, "Save settings");
  assert.equal(anchor.url, "http://fixture.test/settings");
  assert.ok(anchor.text.length <= 240);
  assert.ok(anchor.selector.split(" > ").length <= 6);
  assert.match(anchor.selector, /button#save\\3a primary$/);
  assert.notEqual(sibling, target);

  const injectedFactory = new Function(`${SELECTOR_RUNTIME}; return createBoundedAnchor;`)() as typeof createBoundedAnchor;
  assert.deepEqual(injectedFactory(target, anchor.url), anchor);
});

test("injected overlay source parses as browser JavaScript", () => {
  assert.doesNotThrow(() => new Function(OVERLAY_SOURCE));
});

test("session installs the overlay in the current page and every navigated document", async () => {
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const page: OverlayPage = {
    async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      requests.push({ method, params });
      return {} as T;
    },
  };

  await installOverlay(page);
  assert.deepEqual(requests.map((request) => request.method), [
    "Page.enable",
    "Runtime.enable",
    "Runtime.addBinding",
    "Page.addScriptToEvaluateOnNewDocument",
    "Runtime.evaluate",
  ]);
  assert.equal(requests[3].params.source, requests[4].params.expression);
});

test("session surfaces browser evaluation failures during overlay installation", async () => {
  const page: OverlayPage = {
    async request<T>(method: string): Promise<T> {
      if (method === "Runtime.evaluate") {
        return { exceptionDetails: { exception: { description: "SyntaxError: injected source" } } } as T;
      }
      return {} as T;
    },
  };
  await assert.rejects(installOverlay(page), /SyntaxError: injected source/);
});
