// gsd-button: the prototype's button primitive.
//
// Light DOM on purpose. A shadow root would cut the element off from the token
// custom properties the page imports, so this element owns behavior and state
// only; every visual value lives in primitives/button.css.
const BASE_CLASS = "gsd-button";
const BUSY_FALLBACK = "Working...";

export class GsdButton extends HTMLElement {
  static observedAttributes = ["disabled", "loading", "label", "busy-label"];

  #onClick = (event) => {
    if (!this.disabled) return;
    // A disabled control must not act, and must not let a parent act for it.
    event.preventDefault();
    event.stopPropagation();
  };

  connectedCallback() {
    this.classList.add(BASE_CLASS);
    if (!this.hasAttribute("role")) this.setAttribute("role", "button");
    this.addEventListener("click", this.#onClick);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.#onClick);
  }

  attributeChangedCallback() {
    this.render();
  }

  get loading() {
    return this.hasAttribute("loading");
  }

  // Loading is a disabled state: the action is already in flight.
  get disabled() {
    return this.hasAttribute("disabled") || this.loading;
  }

  render() {
    const disabled = this.disabled;
    this.setAttribute("aria-busy", this.loading ? "true" : "false");
    this.setAttribute("aria-disabled", disabled ? "true" : "false");
    this.setAttribute("tabindex", disabled ? "-1" : "0");
    this.textContent = this.loading
      ? this.getAttribute("busy-label") ?? BUSY_FALLBACK
      : this.getAttribute("label") ?? "";
  }
}

customElements.define("gsd-button", GsdButton);
