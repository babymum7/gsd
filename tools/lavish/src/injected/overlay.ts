import { SELECTOR_RUNTIME } from "./selector.ts";

export type OverlayMode = "interact" | "annotate";
export type OverlayEventAction = "pass" | "annotate" | "region";

export function overlayEventAction(
  mode: OverlayMode,
  toolUi: boolean,
  selectingRegion: boolean,
): OverlayEventAction {
  if (toolUi) return "pass";
  if (selectingRegion) return "region";
  return mode === "annotate" ? "annotate" : "pass";
}

const EVENT_ACTION_RUNTIME = `const overlayEventAction = ${overlayEventAction.toString()};`;

export const OVERLAY_SOURCE = String.raw`(() => {
  const install = () => {
    if (window.__lavishInstalled || !document.documentElement) return;
    ${SELECTOR_RUNTIME}
    ${EVENT_ACTION_RUNTIME}
    const send = (message) => {
      if (typeof window.lavishSend === "function") window.lavishSend(JSON.stringify(message));
    };
    const host = document.createElement("div");
    host.dataset.lavishUi = "true";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = String.raw${"`"}<style>
      :host { all: initial; font: 13px/1.4 system-ui, sans-serif; color: #18212f; }
      .bar { position: fixed; top: 12px; right: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; max-width: min(440px, calc(100vw - 24px)); padding: 8px; border: 1px solid #cbd5e1; border-radius: 10px; background: rgba(255,255,255,.96); box-shadow: 0 8px 26px rgba(15,23,42,.2); pointer-events: auto; }
      button, label { border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 8px; background: #fff; color: #18212f; cursor: pointer; }
      button.active { border-color: #2563eb; background: #dbeafe; color: #1e3a8a; }
      textarea { width: 220px; min-height: 34px; resize: vertical; border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px; font: inherit; }
      .status { flex-basis: 100%; color: #475569; font-size: 12px; }
      .selected { position: fixed; border: 2px solid #2563eb; background: rgba(37,99,235,.08); pointer-events: none; display: none; }
      .region { position: fixed; border: 2px dashed #dc2626; background: rgba(220,38,38,.08); pointer-events: none; display: none; }
      input[type=file] { display: none; }
    </style><div class="bar">
      <button data-mode="interact" class="active">Interact</button><button data-mode="annotate">Annotate</button>
      <button data-capture="viewport">Capture viewport</button><button data-capture="region">Capture region</button>
      <label>Attach image<input data-upload type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
      <textarea data-comment placeholder="Feedback for agent"></textarea><button data-submit>Send feedback</button>
      <div class="status" data-status>Interact mode</div>
    </div><div class="selected"></div><div class="region"></div>${"`"};
    document.documentElement.appendChild(host);

    const status = shadow.querySelector("[data-status]");
    const selectedBox = shadow.querySelector(".selected");
    const regionBox = shadow.querySelector(".region");
    const comment = shadow.querySelector("[data-comment]");
    const attachments = [];
    let mode = "interact";
    let selectedAnchor = null;
    let regionStart = null;
    let selectingRegion = false;

    const setStatus = (text) => {
      if (status) status.textContent = text;
    };
    const isToolUiEvent = (event) => event.composedPath().includes(host);
    const drawSelection = (rect) => {
      if (!selectedBox) return;
      selectedBox.style.display = "block";
      selectedBox.style.left = rect.left + "px";
      selectedBox.style.top = rect.top + "px";
      selectedBox.style.width = rect.width + "px";
      selectedBox.style.height = rect.height + "px";
    };
    const select = (element, selectionText = "") => {
      selectedAnchor = createBoundedAnchor(element, location.href);
      if (selectionText) selectedAnchor.selection = selectionText.trim().replace(/\s+/g, " ").slice(0, 240);
      drawSelection(element.getBoundingClientRect());
      setStatus("Element selected; write feedback or capture a region");
    };
    const attach = (file, source) => {
      if (!file.type.startsWith("image/")) {
        setStatus("Only image attachments are supported");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setStatus("Image attachment exceeds 10 MiB");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => send({
        type: "attachment",
        dataUrl: reader.result,
        source,
        name: file.name || "pasted-image",
      });
      reader.onerror = () => setStatus("Could not read image attachment");
      reader.readAsDataURL(file);
    };

    window.__lavishAttachmentResult = (attachment) => {
      attachments.push(attachment);
      setStatus(attachment.source === "viewport" || attachment.source === "region" ? "Capture attached" : "Image attached");
    };
    window.__lavishCaptureResult = window.__lavishAttachmentResult;
    window.__lavishError = (message) => setStatus(message);
    window.__lavishFeedbackSent = () => setStatus("Feedback sent");

    for (const button of shadow.querySelectorAll("[data-mode]")) {
      button.addEventListener("click", () => {
        mode = button.dataset.mode === "annotate" ? "annotate" : "interact";
        for (const peer of shadow.querySelectorAll("[data-mode]")) {
          peer.classList.toggle("active", peer === button);
        }
        setStatus(mode === "annotate" ? "Annotate mode: click an element or select text" : "Interact mode");
      });
    }
    shadow.querySelector("[data-submit]").addEventListener("click", () => {
      send({
        type: "feedback",
        deliveryId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
        comment: comment.value,
        anchor: selectedAnchor,
        attachments: attachments.splice(0),
      });
      comment.value = "";
      setStatus("Sending feedback");
    });
    shadow.querySelector("[data-upload]").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) attach(file, "upload");
      event.target.value = "";
    });
    shadow.querySelector("[data-capture=viewport]").addEventListener("click", () => {
      send({ type: "capture", mode: "viewport" });
      setStatus("Capturing viewport");
    });
    shadow.querySelector("[data-capture=region]").addEventListener("click", () => {
      selectingRegion = true;
      setStatus("Drag a region in the app");
    });
    document.addEventListener("paste", (event) => {
      const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      attach(file, "paste");
    }, true);
    document.addEventListener("click", (event) => {
      if (overlayEventAction(mode, isToolUiEvent(event), selectingRegion) !== "annotate") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.target instanceof Element) select(event.target);
    }, true);
    document.addEventListener("mouseup", () => {
      if (mode !== "annotate") return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.anchorNode) return;
      const element = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
      if (element && !element.closest("[data-lavish-ui]")) select(element, selection.toString());
    }, true);
    document.addEventListener("pointerdown", (event) => {
      if (overlayEventAction(mode, isToolUiEvent(event), selectingRegion) !== "region") return;
      regionStart = { x: event.clientX, y: event.clientY };
      regionBox.style.display = "block";
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    document.addEventListener("pointermove", (event) => {
      if (!regionStart) return;
      const left = Math.min(regionStart.x, event.clientX);
      const top = Math.min(regionStart.y, event.clientY);
      regionBox.style.left = left + "px";
      regionBox.style.top = top + "px";
      regionBox.style.width = Math.abs(event.clientX - regionStart.x) + "px";
      regionBox.style.height = Math.abs(event.clientY - regionStart.y) + "px";
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    document.addEventListener("pointerup", (event) => {
      if (!regionStart) return;
      const left = Math.min(regionStart.x, event.clientX);
      const top = Math.min(regionStart.y, event.clientY);
      const width = Math.abs(event.clientX - regionStart.x);
      const height = Math.abs(event.clientY - regionStart.y);
      regionStart = null;
      selectingRegion = false;
      regionBox.style.display = "none";
      if (width > 0 && height > 0) {
        send({ type: "capture", mode: "region", region: { x: left, y: top, width, height } });
        setStatus("Capturing region");
      } else {
        setStatus("Region capture cancelled");
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    window.__lavishInstalled = true;
    send({ type: "ready", url: location.href });
  };
  window.__lavishInstall = install;
  if (document.documentElement) {
    install();
  } else {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  }
})();`;
