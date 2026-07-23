import { test } from "bun:test";
import assert from "node:assert/strict";
import { installOverlay, type OverlayPage } from "../src/session.ts";
import { OVERLAY_SOURCE, overlayEventAction } from "../src/injected/overlay.ts";
import {
  createBoundedAnchor,
  SELECTOR_RUNTIME,
  type AnchorElement,
} from "../src/injected/selector.ts";
import { createEditorState, reduceEditor } from "../src/editor/model.ts";

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
  assert.equal(overlayEventAction("annotate", false, false, true), "preserve");
});

test("editor reducer queues, removes, and atomically acknowledges Send now", () => {
  let state = createEditorState();
  state = reduceEditor(state, { type: "compose", value: "Align the panel" }).state;
  state = reduceEditor(state, {
    type: "select",
    anchor: { tag: "section", selector: "main > section", text: "Account" },
  }).state;
  const queued = reduceEditor(state, {
    type: "key",
    key: "Enter",
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    draftId: "draft-0001",
    deliveryId: "delivery-unused",
    createdAt: "2026-07-23T00:00:00.000Z",
  });
  assert.deepEqual(queued.effects.map((effect) => effect.type), ["prevent-default", "queue"]);
  assert.equal(queued.state.drafts[0].comment, "Align the panel");
  assert.equal(queued.state.composer, "");

  const removed = reduceEditor(queued.state, { type: "remove-draft", draftId: "draft-0001" });
  assert.deepEqual(removed.effects, [{ type: "remove", draftId: "draft-0001" }]);
  assert.deepEqual(removed.state.drafts, []);

  state = reduceEditor(queued.state, { type: "compose", value: "Send this too" }).state;
  const sending = reduceEditor(state, {
    type: "key",
    key: "Enter",
    shiftKey: false,
    ctrlKey: true,
    metaKey: false,
    draftId: "draft-0002",
    deliveryId: "delivery-0001",
    createdAt: "2026-07-23T00:01:00.000Z",
  });
  assert.deepEqual(sending.effects.map((effect) => effect.type), ["prevent-default", "send"]);
  const sendEffect = sending.effects.find((effect) => effect.type === "send");
  assert.equal(sendEffect?.current?.comment, "Send this too");
  assert.equal(sending.state.sending, true);

  const acknowledged = reduceEditor(sending.state, {
    type: "sent",
    delivery: {
      cursor: 1,
      deliveryId: "delivery-0001",
      createdAt: "2026-07-23T00:01:01.000Z",
      items: [...queued.state.drafts, sendEffect!.current!],
    },
  });
  assert.equal(acknowledged.state.sending, false);
  assert.deepEqual(acknowledged.state.drafts, []);
  assert.equal(acknowledged.state.history.length, 2);
});

test("editor reducer preserves newline input and tracks responsive review context", () => {
  let state = createEditorState();
  state = reduceEditor(state, { type: "viewport", width: 480 }).state;
  state = reduceEditor(state, { type: "toggle-collapsed" }).state;
  state = reduceEditor(state, { type: "mode", mode: "annotate" }).state;
  state = reduceEditor(state, { type: "presence", presence: "listening" }).state;
  state = reduceEditor(state, {
    type: "attach",
    attachment: {
      id: "attachment-0001",
      name: "viewport.png",
      source: "viewport",
      mime: "image/png",
      bytes: 128,
      width: 10,
      height: 10,
    },
  }).state;
  const newline = reduceEditor(state, {
    type: "key",
    key: "Enter",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    draftId: "draft-0001",
    deliveryId: "delivery-0001",
    createdAt: "2026-07-23T00:00:00.000Z",
  });
  assert.deepEqual(newline.effects, []);
  assert.equal(newline.state.narrow, true);
  assert.equal(newline.state.collapsed, true);
  assert.equal(newline.state.mode, "annotate");
  assert.equal(newline.state.presence, "listening");
  assert.equal(newline.state.attachments.length, 1);
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
  assert.match(OVERLAY_SOURCE, /attachShadow\(\{ mode: "closed" \}\)/);
});

test("session installs the overlay in an isolated world for current and navigated documents", async () => {
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  let contextCreated: ((params: Record<string, unknown>) => void) | undefined;
  const page: OverlayPage = {
    async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      requests.push({ method, params });
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "main-frame" } } } as T;
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 42 } as T;
      return {} as T;
    },
    on(method, handler) {
      if (method === "Runtime.executionContextCreated") contextCreated = handler;
    },
  };

  const installed = await installOverlay(page, {
    bindingName: "lavish_test_binding",
    worldName: "lavish-test-world",
  });
  assert.deepEqual(requests.map((request) => request.method), [
    "Page.enable",
    "Runtime.enable",
    "Runtime.addBinding",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.getFrameTree",
    "Page.createIsolatedWorld",
    "Runtime.evaluate",
  ]);
  assert.equal(requests[2].params.name, "lavish_test_binding");
  assert.equal(requests[2].params.executionContextName, "lavish-test-world");
  assert.equal(requests[3].params.worldName, "lavish-test-world");
  assert.equal(requests[5].params.grantUniveralAccess, false);
  assert.equal(requests[6].params.contextId, 42);
  assert.match(String(requests[3].params.source), /lavish_test_binding/);

  await installed.evaluate("window.__lavishPresence?.('listening')");
  assert.equal(requests.at(-1)?.params.contextId, 42);
  contextCreated?.({
    context: {
      id: 99,
      name: "lavish-test-world",
      auxData: { frameId: "child-frame" },
    },
  });
  await installed.evaluate("window.__lavishPresence?.('working')");
  assert.equal(requests.at(-1)?.params.contextId, 42);
  contextCreated?.({
    context: {
      id: 43,
      name: "lavish-test-world",
      auxData: { frameId: "main-frame" },
    },
  });
  await installed.evaluate("window.__lavishPresence?.('listening')");
  assert.equal(requests.at(-1)?.params.contextId, 43);
});

test("session surfaces browser evaluation failures during overlay installation", async () => {
  const page: OverlayPage = {
    async request<T>(method: string): Promise<T> {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "main-frame" } } } as T;
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 42 } as T;
      if (method === "Runtime.evaluate") {
        return { exceptionDetails: { exception: { description: "SyntaxError: injected source" } } } as T;
      }
      return {} as T;
    },
    on() {},
  };
  await assert.rejects(
    installOverlay(page, { bindingName: "lavish_test_binding", worldName: "lavish-test-world" }),
    /SyntaxError: injected source/,
  );
});
