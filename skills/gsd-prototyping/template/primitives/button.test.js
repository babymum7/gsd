// Headless behavior test for the gsd-button primitive.
//
// No browser: a minimal DOM stub is enough to prove the element's observable state,
// which keeps this test inside `check:fast`. Rendering fidelity is `check:slow`.
import { test } from "node:test";
import assert from "node:assert/strict";

// The smallest DOM the primitive actually touches: attributes, classList,
// textContent, and click listeners.
class StubElement {
  #attributes = new Map();
  #listeners = new Map();

  textContent = "";
  classList = {
    values: new Set(),
    add: (...names) => names.forEach((name) => this.classList.values.add(name)),
    contains: (name) => this.classList.values.has(name),
  };

  hasAttribute(name) {
    return this.#attributes.has(name);
  }

  getAttribute(name) {
    return this.#attributes.has(name) ? this.#attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.#attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.#attributes.delete(name);
  }

  addEventListener(type, handler) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.#listeners.get(type)?.delete(handler);
  }

  dispatchEvent(event) {
    for (const handler of this.#listeners.get(event.type) ?? []) handler(event);
    return !event.defaultPrevented;
  }
}

const registered = new Map();
globalThis.HTMLElement = StubElement;
globalThis.customElements = {
  define: (name, constructor) => registered.set(name, constructor),
  get: (name) => registered.get(name),
};

const { GsdButton } = await import("./button.js");

const mount = (attributes = {}) => {
  const element = new GsdButton();
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.connectedCallback();
  return element;
};

const clickEvent = () => ({
  type: "click",
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
  stopPropagation() {
    this.propagationStopped = true;
  },
});

test("the primitive registers itself as a custom element", () => {
  assert.equal(customElements.get("gsd-button"), GsdButton);
});

test("an idle button renders its label and is reachable", () => {
  const button = mount({ label: "Save" });
  assert.equal(button.textContent, "Save");
  assert.equal(button.getAttribute("role"), "button");
  assert.equal(button.getAttribute("aria-disabled"), "false");
  assert.equal(button.getAttribute("aria-busy"), "false");
  assert.equal(button.getAttribute("tabindex"), "0");
  assert.equal(button.classList.contains("gsd-button"), true);
});

test("a loading button announces busy state and its busy label", () => {
  const button = mount({ label: "Save", "busy-label": "Saving...", loading: "" });
  assert.equal(button.textContent, "Saving...");
  assert.equal(button.getAttribute("aria-busy"), "true");
  // Loading is a disabled state: the action is already in flight.
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(button.getAttribute("tabindex"), "-1");
});

test("a disabled button swallows its click instead of acting", () => {
  const button = mount({ label: "Save", disabled: "" });
  const event = clickEvent();
  button.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("an enabled button lets its click through", () => {
  const button = mount({ label: "Save" });
  let clicks = 0;
  button.addEventListener("click", () => { clicks += 1; });
  const event = clickEvent();
  button.dispatchEvent(event);
  assert.equal(clicks, 1);
  assert.equal(event.defaultPrevented, false);
});

test("changing an attribute re-renders the label", () => {
  const button = mount({ label: "Save" });
  button.setAttribute("label", "Publish");
  button.attributeChangedCallback();
  assert.equal(button.textContent, "Publish");
});
