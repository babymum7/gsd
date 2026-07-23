import { EDITOR_MODEL_RUNTIME } from "../editor/model.ts";
import { SELECTOR_RUNTIME } from "./selector.ts";

export type OverlayMode = "interact" | "annotate";
export type OverlayEventAction = "pass" | "annotate" | "region" | "preserve";

export function overlayEventAction(
  mode: OverlayMode,
  toolUi: boolean,
  selectingRegion: boolean,
  preserveClick = false,
): OverlayEventAction {
  if (toolUi) return "pass";
  if (selectingRegion) return "region";
  if (preserveClick) return "preserve";
  return mode === "annotate" ? "annotate" : "pass";
}

const EVENT_ACTION_RUNTIME = `const overlayEventAction = ${overlayEventAction.toString()};`;

const EDITOR_MARKUP = String.raw`<style>
  :host {
    all: initial;
    color-scheme: dark;
    --ink: #17140f;
    --ink-raised: #211d17;
    --ink-soft: #2b251d;
    --paper: #f1e7d2;
    --paper-muted: #b9ad98;
    --brass: #c8a35e;
    --brass-bright: #e0bd77;
    --line: rgba(224, 189, 119, .24);
    --danger: #d9856c;
    font: 13px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  button, textarea, input { font: inherit; }
  button { -webkit-tap-highlight-color: transparent; }
  .shell { position: fixed; inset: 0; pointer-events: none; color: var(--paper); }
  .drawer {
    pointer-events: auto;
    position: fixed;
    inset: 0 0 0 auto;
    width: 360px;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
    background:
      radial-gradient(circle at 90% -10%, rgba(200, 163, 94, .14), transparent 35%),
      linear-gradient(180deg, #211d17 0%, #17140f 100%);
    border-left: 1px solid var(--line);
    box-shadow: -18px 0 52px rgba(0, 0, 0, .38);
  }
  .shell[data-collapsed="true"] .drawer { display: none; }
  .rail {
    display: none;
    pointer-events: auto;
    position: fixed;
    right: 12px;
    top: 12px;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line);
    border-radius: 12px;
    color: var(--brass-bright);
    background: var(--ink-raised);
    box-shadow: 0 12px 32px rgba(0, 0, 0, .34);
    cursor: pointer;
    font-weight: 800;
    letter-spacing: .08em;
  }
  .shell[data-collapsed="true"] .rail { display: flex; }
  .masthead { display: flex; align-items: center; gap: 10px; padding: 15px 14px 12px; border-bottom: 1px solid var(--line); }
  .mark { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--brass); border-radius: 9px; color: var(--brass-bright); font: 700 15px/1 Georgia, serif; }
  .identity { min-width: 0; flex: 1; }
  .title { color: var(--paper); font: 650 14px/1.2 Georgia, serif; letter-spacing: .035em; }
  .presence { display: flex; align-items: center; gap: 6px; margin-top: 4px; color: var(--paper-muted); font-size: 11px; }
  .presence-dot { width: 6px; height: 6px; border-radius: 50%; background: #756d60; box-shadow: 0 0 0 3px rgba(117, 109, 96, .12); }
  .presence[data-presence="listening"] .presence-dot { background: #8ebd89; box-shadow: 0 0 0 3px rgba(142, 189, 137, .14); }
  .presence[data-presence="working"] .presence-dot { background: var(--brass-bright); box-shadow: 0 0 0 3px rgba(224, 189, 119, .14); }
  .icon-button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid transparent; border-radius: 8px; color: var(--paper-muted); background: transparent; cursor: pointer; }
  .icon-button:hover, .icon-button:focus-visible { border-color: var(--line); color: var(--paper); outline: none; background: rgba(255,255,255,.04); }
  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 8px 12px; border-bottom: 1px solid rgba(224, 189, 119, .12); }
  .mode { min-height: 34px; border: 1px solid transparent; border-radius: 8px; color: var(--paper-muted); background: transparent; cursor: pointer; }
  .mode:hover { color: var(--paper); background: rgba(255,255,255,.035); }
  .mode.active { color: var(--ink); border-color: var(--brass); background: var(--brass); font-weight: 700; }
  .history { min-height: 0; overflow: auto; padding: 16px 13px 20px; scrollbar-color: rgba(224,189,119,.26) transparent; }
  .empty { display: grid; min-height: 100%; align-content: center; justify-items: center; gap: 8px; padding: 32px; text-align: center; color: var(--paper-muted); }
  .empty strong { color: var(--paper); font: 600 16px/1.25 Georgia, serif; }
  .message { max-width: 90%; margin: 0 0 12px; padding: 10px 11px; border: 1px solid rgba(255,255,255,.07); border-radius: 12px 12px 12px 4px; color: var(--paper); background: rgba(255,255,255,.05); overflow-wrap: anywhere; }
  .message.human { margin-left: auto; border-color: rgba(200,163,94,.3); border-radius: 12px 12px 4px 12px; background: rgba(200,163,94,.13); }
  .message-meta { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 5px; color: var(--paper-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; }
  .message-anchor { margin-top: 7px; color: var(--brass-bright); font-size: 11px; }
  .message-files { margin-top: 7px; color: var(--paper-muted); font-size: 11px; }
  .queue-wrap { display: none; max-height: 132px; overflow: auto; padding: 9px 12px; border-top: 1px solid rgba(224, 189, 119, .12); background: rgba(0,0,0,.12); }
  .queue-wrap.visible { display: block; }
  .queue-heading { display: flex; justify-content: space-between; margin-bottom: 7px; color: var(--paper-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
  .queue-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .queue-pill, .attachment-pill, .anchor-pill { display: inline-flex; min-width: 0; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; color: var(--paper); background: rgba(200,163,94,.08); }
  .queue-pill { max-width: 100%; padding: 5px 5px 5px 9px; }
  .pill-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill-remove { flex: 0 0 auto; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; color: var(--paper-muted); background: rgba(0,0,0,.2); cursor: pointer; }
  .pill-remove:hover { color: var(--paper); background: rgba(217,133,108,.25); }
  .composer { position: relative; padding: 11px 12px 12px; border-top: 1px solid var(--line); background: rgba(23,20,15,.96); }
  .context-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .anchor-pill { max-width: 100%; padding: 4px 5px 4px 9px; color: var(--brass-bright); font-size: 11px; }
  .attachments { display: flex; flex-wrap: wrap; gap: 5px; }
  .attachment-pill { padding: 4px 5px 4px 8px; font-size: 11px; }
  .input-shell { border: 1px solid rgba(224,189,119,.26); border-radius: 11px; background: rgba(255,255,255,.045); transition: border-color .15s, box-shadow .15s; }
  .input-shell:focus-within { border-color: var(--brass); box-shadow: 0 0 0 3px rgba(200,163,94,.09); }
  textarea { display: block; width: 100%; min-height: 68px; max-height: 180px; padding: 10px 11px 6px; resize: vertical; border: 0; outline: none; color: var(--paper); caret-color: var(--brass-bright); background: transparent; }
  textarea::placeholder { color: #817869; }
  .composer-actions { display: flex; align-items: center; gap: 6px; padding: 6px; }
  .spacer { flex: 1; }
  .action { min-height: 32px; padding: 0 11px; border: 1px solid var(--line); border-radius: 8px; color: var(--paper); background: transparent; cursor: pointer; }
  .action:hover, .action:focus-visible { border-color: var(--brass); outline: none; background: rgba(200,163,94,.08); }
  .action.primary { border-color: var(--brass); color: var(--ink); background: var(--brass); font-weight: 750; }
  .action.primary:hover { background: var(--brass-bright); }
  .action:disabled { opacity: .48; cursor: wait; }
  details { position: relative; }
  summary { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; color: var(--paper-muted); cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary:hover { color: var(--paper); background: rgba(255,255,255,.05); }
  .extras { position: absolute; right: 0; bottom: 38px; width: 190px; display: grid; gap: 4px; padding: 7px; border: 1px solid var(--line); border-radius: 10px; background: var(--ink-soft); box-shadow: 0 14px 36px rgba(0,0,0,.45); }
  .extra { min-height: 34px; padding: 0 9px; border: 0; border-radius: 7px; color: var(--paper); text-align: left; background: transparent; cursor: pointer; }
  .extra:hover { background: rgba(200,163,94,.1); }
  .extra input { display: none; }
  .activity { min-height: 18px; padding: 6px 2px 0; color: var(--paper-muted); font-size: 11px; }
  .activity.error { color: var(--danger); }
  .selection, .hover, .region, .text-highlight { position: fixed; display: none; pointer-events: none; }
  .selection { border: 2px solid var(--brass-bright); background: rgba(224,189,119,.08); box-shadow: 0 0 0 1px rgba(0,0,0,.25); }
  .hover { border: 1px dashed var(--brass); background: rgba(200,163,94,.05); }
  .region { border: 2px dashed var(--danger); background: rgba(217,133,108,.09); }
  .text-layer { position: fixed; inset: 0; pointer-events: none; }
  .text-highlight { display: block; border-radius: 2px; background: rgba(224,189,119,.24); outline: 1px solid rgba(224,189,119,.38); }
  .annotation-card { pointer-events: auto; position: fixed; z-index: 2; width: min(280px, calc(100vw - 24px)); display: none; padding: 10px; border: 1px solid var(--brass); border-radius: 11px; color: var(--paper); background: var(--ink-raised); box-shadow: 0 16px 42px rgba(0,0,0,.46); }
  .annotation-card.visible { display: block; }
  .annotation-label { margin-bottom: 7px; color: var(--brass-bright); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .annotation-card textarea { min-height: 62px; margin-bottom: 7px; border: 1px solid var(--line); border-radius: 8px; }
  .annotation-actions { display: flex; justify-content: flex-end; gap: 6px; }
  @media (max-width: 639px) {
    .drawer { width: min(100vw, 360px); }
    .masthead { padding-top: max(12px, env(safe-area-inset-top)); }
    .composer { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
    .action { min-width: 74px; }
  }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
</style>
<div class="shell" data-shell data-collapsed="false" data-mode="interact">
  <aside class="drawer" aria-label="Lavish review editor">
    <header class="masthead">
      <div class="mark" aria-hidden="true">L</div>
      <div class="identity"><div class="title">Lavish review</div><div class="presence" data-presence><span class="presence-dot"></span><span data-presence-text>Agent offline</span></div></div>
      <button class="icon-button" type="button" data-collapse aria-label="Collapse review editor" title="Collapse review editor">−</button>
    </header>
    <nav class="modes" aria-label="Review mode">
      <button class="mode active" type="button" data-mode="interact" aria-pressed="true">Interact</button>
      <button class="mode" type="button" data-mode="annotate" aria-pressed="false">Annotate</button>
    </nav>
    <section class="history" data-history aria-label="Review conversation"><div class="empty" data-empty><strong>Review the experience</strong><span>Interact normally, or annotate an element and queue precise feedback.</span></div></section>
    <section class="queue-wrap" data-queue-wrap><div class="queue-heading"><span>Queued for agent</span><span data-queue-count>0</span></div><div class="queue-list" data-queue-list></div></section>
    <footer class="composer">
      <div class="context-row"><span class="anchor-pill" data-anchor-pill hidden><span data-anchor-text></span><button class="pill-remove" type="button" data-clear-anchor aria-label="Remove annotation">×</button></span><span class="attachments" data-attachments></span></div>
      <div class="input-shell">
        <textarea data-comment placeholder="Describe what should change…" aria-label="Feedback for agent"></textarea>
        <div class="composer-actions">
          <details data-more><summary aria-label="Add image or capture" title="Add image or capture">•••</summary><div class="extras">
            <button class="extra" type="button" data-capture="viewport">Capture viewport</button>
            <button class="extra" type="button" data-capture="region">Capture region</button>
            <label class="extra">Attach image<input data-upload type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
          </div></details>
          <span class="spacer"></span><button class="action" type="button" data-queue>Queue</button><button class="action primary" type="button" data-send>Send now</button>
        </div>
      </div>
      <div class="activity" data-status aria-live="polite">Interact mode</div>
    </footer>
  </aside>
  <button class="rail" type="button" data-expand aria-label="Open Lavish review editor" title="Open Lavish review editor">L</button>
  <div class="hover" data-hover></div><div class="selection" data-selection></div><div class="text-layer" data-text-layer></div><div class="region" data-region></div>
  <section class="annotation-card" data-annotation-card aria-label="Element annotation">
    <div class="annotation-label" data-annotation-label></div><textarea data-context-comment placeholder="Feedback for this element…" aria-label="Element feedback"></textarea>
    <div class="annotation-actions"><button class="action" type="button" data-cancel-annotation>Cancel</button><button class="action primary" type="button" data-context-queue>Queue</button></div>
  </section>
</div>`;

export function createOverlaySource(bindingName: string): string {
  return String.raw`(() => {
    const install = () => {
      if (window.top !== window || window.__lavishInstalled || !document.documentElement) return;
      ${SELECTOR_RUNTIME}
      ${EVENT_ACTION_RUNTIME}
      ${EDITOR_MODEL_RUNTIME}
      const bindingName = ${JSON.stringify(bindingName)};
      const send = (message) => {
        const binding = window[bindingName];
        if (typeof binding === "function") binding(JSON.stringify(message));
      };
      const id = (prefix) => prefix + "-" + (typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
      const safeAttachment = (attachment) => ({
        id: String(attachment.id || ""),
        name: String(attachment.name || "image"),
        mime: String(attachment.mime || "image/png"),
        bytes: Number(attachment.bytes || 0),
        width: Number(attachment.width || 0),
        height: Number(attachment.height || 0),
        source: attachment.source || "upload",
      });
      const host = document.createElement("div");
      host.dataset.lavishUi = "true";
      host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
      const shadow = host.attachShadow({ mode: "closed" });
      shadow.innerHTML = ${JSON.stringify(EDITOR_MARKUP)};
      document.documentElement.appendChild(host);

      const shell = shadow.querySelector("[data-shell]");
      const history = shadow.querySelector("[data-history]");
      const queueWrap = shadow.querySelector("[data-queue-wrap]");
      const queueList = shadow.querySelector("[data-queue-list]");
      const queueCount = shadow.querySelector("[data-queue-count]");
      const comment = shadow.querySelector("[data-comment]");
      const contextComment = shadow.querySelector("[data-context-comment]");
      const contextCard = shadow.querySelector("[data-annotation-card]");
      const contextLabel = shadow.querySelector("[data-annotation-label]");
      const anchorPill = shadow.querySelector("[data-anchor-pill]");
      const anchorText = shadow.querySelector("[data-anchor-text]");
      const attachmentList = shadow.querySelector("[data-attachments]");
      const status = shadow.querySelector("[data-status]");
      const selectedBox = shadow.querySelector("[data-selection]");
      const hoverBox = shadow.querySelector("[data-hover]");
      const regionBox = shadow.querySelector("[data-region]");
      const textLayer = shadow.querySelector("[data-text-layer]");
      const presence = shadow.querySelector("[data-presence]");
      const presenceText = shadow.querySelector("[data-presence-text]");
      const sendButton = shadow.querySelector("[data-send]");
      let state = createEditorState();
      let activity = "Interact mode";
      let selectedElement = null;
      let selectedRange = null;
      let regionStart = null;
      let selectingRegion = false;
      let suppressNextClick = false;

      const isToolUiEvent = (event) => event.composedPath().includes(host);
      const setBox = (box, rect) => {
        if (!box || !rect) return;
        box.style.display = "block";
        box.style.left = rect.left + "px";
        box.style.top = rect.top + "px";
        box.style.width = rect.width + "px";
        box.style.height = rect.height + "px";
      };
      const hideBox = (box) => { if (box) box.style.display = "none"; };
      const anchorLabel = (anchor) => {
        if (!anchor) return "";
        return anchor.name || anchor.text || anchor.selector || anchor.tag || "Selected element";
      };
      const positionCard = (rect) => {
        if (!contextCard || !rect) return;
        const width = Math.min(280, innerWidth - 24);
        const preferredLeft = rect.right + 12;
        const left = preferredLeft + width <= innerWidth - 12
          ? preferredLeft
          : Math.max(12, Math.min(rect.left, innerWidth - width - 12));
        const top = Math.max(12, Math.min(rect.top, innerHeight - 190));
        contextCard.style.left = left + "px";
        contextCard.style.top = top + "px";
      };
      const renderHighlights = () => {
        textLayer.replaceChildren();
        if (!selectedRange) return;
        for (const rect of selectedRange.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          const highlight = document.createElement("span");
          highlight.className = "text-highlight";
          highlight.style.left = rect.left + "px";
          highlight.style.top = rect.top + "px";
          highlight.style.width = rect.width + "px";
          highlight.style.height = rect.height + "px";
          textLayer.appendChild(highlight);
        }
      };
      const redrawSelection = () => {
        if (!selectedElement || !selectedElement.isConnected || state.mode !== "annotate") {
          hideBox(selectedBox);
          return;
        }
        const rect = selectedElement.getBoundingClientRect();
        setBox(selectedBox, rect);
        positionCard(rect);
        renderHighlights();
      };
      const makePillRemove = (label, handler) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pill-remove";
        button.textContent = "×";
        button.setAttribute("aria-label", label);
        button.addEventListener("click", handler);
        return button;
      };
      const render = () => {
        shell.dataset.collapsed = String(state.collapsed);
        shell.dataset.mode = state.mode;
        shell.dataset.narrow = String(state.narrow);
        for (const button of shadow.querySelectorAll("[data-mode]")) {
          const active = button.dataset.mode === state.mode;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        }
        presence.dataset.presence = state.presence;
        presenceText.textContent = state.presence === "listening"
          ? "Agent listening"
          : state.presence === "working" ? "Agent working" : "Agent offline";
        if (comment.value !== state.composer) comment.value = state.composer;
        if (contextComment.value !== state.composer) contextComment.value = state.composer;
        sendButton.disabled = state.sending;
        sendButton.textContent = state.sending ? "Sending…" : "Send now";
        status.textContent = state.error || activity;
        status.classList.toggle("error", Boolean(state.error));

        history.replaceChildren();
        if (state.history.length === 0) {
          const empty = document.createElement("div");
          empty.className = "empty";
          const title = document.createElement("strong");
          title.textContent = "Review the experience";
          const hint = document.createElement("span");
          hint.textContent = "Interact normally, or annotate an element and queue precise feedback.";
          empty.append(title, hint);
          history.appendChild(empty);
        } else {
          for (const entry of state.history) {
            const bubble = document.createElement("article");
            bubble.className = "message " + entry.role;
            const meta = document.createElement("div");
            meta.className = "message-meta";
            const role = document.createElement("span");
            role.textContent = entry.role === "agent" ? "Agent" : "You";
            const time = document.createElement("time");
            time.textContent = new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            meta.append(role, time);
            const body = document.createElement("div");
            body.textContent = entry.text || "Image feedback";
            bubble.append(meta, body);
            if (entry.anchor) {
              const anchor = document.createElement("div");
              anchor.className = "message-anchor";
              anchor.textContent = "On: " + anchorLabel(entry.anchor);
              bubble.appendChild(anchor);
            }
            if (entry.attachments.length > 0) {
              const files = document.createElement("div");
              files.className = "message-files";
              files.textContent = entry.attachments.length + (entry.attachments.length === 1 ? " image" : " images");
              bubble.appendChild(files);
            }
            history.appendChild(bubble);
          }
          history.scrollTop = history.scrollHeight;
        }

        queueList.replaceChildren();
        queueCount.textContent = String(state.drafts.length);
        queueWrap.classList.toggle("visible", state.drafts.length > 0);
        for (const draft of state.drafts) {
          const pill = document.createElement("span");
          pill.className = "queue-pill";
          const text = document.createElement("span");
          text.className = "pill-text";
          text.textContent = draft.comment || (draft.attachments.length + " image feedback");
          pill.append(text, makePillRemove("Remove queued feedback", () => dispatch({ type: "remove-draft", draftId: draft.draftId })));
          queueList.appendChild(pill);
        }

        anchorPill.hidden = !state.anchor;
        anchorText.textContent = anchorLabel(state.anchor);
        attachmentList.replaceChildren();
        for (const attachment of state.attachments) {
          const pill = document.createElement("span");
          pill.className = "attachment-pill";
          const text = document.createElement("span");
          text.className = "pill-text";
          text.textContent = attachment.name;
          pill.append(text, makePillRemove("Remove " + attachment.name, () => dispatch({ type: "remove-attachment", attachmentId: attachment.id })));
          attachmentList.appendChild(pill);
        }
        contextCard.classList.toggle("visible", Boolean(state.anchor) && state.mode === "annotate");
        contextLabel.textContent = anchorLabel(state.anchor);
        if (state.mode !== "annotate") {
          hideBox(selectedBox);
          hideBox(hoverBox);
          textLayer.replaceChildren();
          contextCard.classList.remove("visible");
        } else {
          redrawSelection();
        }
      };
      const applyEffect = (effect, sourceEvent) => {
        if (effect.type === "prevent-default") {
          sourceEvent && sourceEvent.preventDefault();
          return;
        }
        if (effect.type === "queue") {
          send({
            type: "queue",
            draftId: effect.draft.draftId,
            comment: effect.draft.comment,
            anchor: effect.draft.anchor,
            attachments: effect.draft.attachments.map((attachment) => attachment.id),
          });
          activity = "Queued for Send now";
          return;
        }
        if (effect.type === "remove") {
          send({ type: "remove", draftId: effect.draftId });
          activity = "Removed from queue";
          return;
        }
        if (effect.type === "send") {
          send({
            type: "feedback",
            deliveryId: effect.deliveryId,
            draftId: effect.current ? effect.current.draftId : effect.deliveryId,
            comment: effect.current ? effect.current.comment : "",
            anchor: effect.current ? effect.current.anchor : null,
            attachments: effect.current ? effect.current.attachments.map((attachment) => attachment.id) : [],
          });
          activity = "Sending queued feedback";
        }
      };
      const dispatch = (event, sourceEvent) => {
        const transition = reduceEditor(state, event);
        state = transition.state;
        for (const effect of transition.effects) applyEffect(effect, sourceEvent);
        render();
      };
      const queueCurrent = (sourceEvent) => dispatch({
        type: "queue",
        draftId: id("draft"),
        createdAt: new Date().toISOString(),
      }, sourceEvent);
      const sendNow = (sourceEvent) => dispatch({
        type: "send",
        deliveryId: id("delivery"),
        currentDraftId: id("draft"),
        createdAt: new Date().toISOString(),
      }, sourceEvent);
      const handleComposerKey = (event) => dispatch({
        type: "key",
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        draftId: id("draft"),
        deliveryId: id("delivery"),
        createdAt: new Date().toISOString(),
      }, event);
      const select = (element, selectionText, range) => {
        selectedElement = element;
        selectedRange = range || null;
        const anchor = createBoundedAnchor(element, location.href);
        if (selectionText) anchor.selection = selectionText.trim().replace(/\s+/g, " ").slice(0, 240);
        dispatch({ type: "select", anchor });
        activity = selectionText ? "Text selection ready for feedback" : "Element ready for feedback";
        render();
        contextComment.focus({ preventScroll: true });
      };
      const clearSelection = () => {
        selectedElement = null;
        selectedRange = null;
        dispatch({ type: "select", anchor: null });
        hideBox(selectedBox);
        textLayer.replaceChildren();
      };
      const attach = (file, source) => {
        if (!file.type.startsWith("image/")) {
          dispatch({ type: "error", message: "Only image attachments are supported." });
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          dispatch({ type: "error", message: "Image attachment exceeds 10 MiB." });
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          activity = "Uploading image";
          send({ type: "attachment", dataUrl: reader.result, source, name: file.name || "pasted-image" });
          render();
        };
        reader.onerror = () => dispatch({ type: "error", message: "Could not read image attachment." });
        reader.readAsDataURL(file);
      };

      window.__lavishAttachmentResult = (attachment) => {
        dispatch({ type: "attach", attachment: safeAttachment(attachment) });
        activity = attachment.source === "viewport" || attachment.source === "region" ? "Capture attached" : "Image attached";
        render();
      };
      window.__lavishError = (message) => dispatch({ type: "error", message: String(message || "Unknown Lavish error") });
      window.__lavishDraftsUpdated = (drafts) => dispatch({ type: "drafts", drafts: drafts || [] });
      window.__lavishFeedbackSent = (result) => {
        if (result && result.delivery) dispatch({ type: "sent", delivery: result.delivery });
        activity = "Feedback delivered to agent";
        render();
      };
      window.__lavishSessionReady = (payload) => dispatch({
        type: "hydrate",
        drafts: payload && payload.drafts || [],
        deliveries: payload && payload.history && payload.history.deliveries || [],
        replies: payload && payload.history && payload.history.replies || [],
      });
      window.__lavishPresence = (value) => dispatch({
        type: "presence",
        presence: value === "listening" || value === "working" ? value : "offline",
      });
      window.__lavishAgentReply = (reply) => dispatch({ type: "reply", reply });

      shadow.querySelector("[data-collapse]").addEventListener("click", () => dispatch({ type: "toggle-collapsed" }));
      shadow.querySelector("[data-expand]").addEventListener("click", () => dispatch({ type: "toggle-collapsed" }));
      for (const button of shadow.querySelectorAll("button[data-mode]")) {
        button.addEventListener("click", () => {
          const mode = button.dataset.mode === "annotate" ? "annotate" : "interact";
          activity = mode === "annotate" ? "Annotate mode: click an element or select text" : "Interact mode";
          dispatch({ type: "mode", mode });
        });
      }
      comment.addEventListener("input", () => dispatch({ type: "compose", value: comment.value }));
      contextComment.addEventListener("input", () => dispatch({ type: "compose", value: contextComment.value }));
      comment.addEventListener("keydown", handleComposerKey);
      contextComment.addEventListener("keydown", handleComposerKey);
      shadow.querySelector("[data-queue]").addEventListener("click", queueCurrent);
      shadow.querySelector("[data-context-queue]").addEventListener("click", queueCurrent);
      shadow.querySelector("[data-send]").addEventListener("click", sendNow);
      shadow.querySelector("[data-clear-anchor]").addEventListener("click", clearSelection);
      shadow.querySelector("[data-cancel-annotation]").addEventListener("click", clearSelection);
      shadow.querySelector("[data-upload]").addEventListener("change", (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) attach(file, "upload");
        event.target.value = "";
      });
      shadow.querySelector("[data-capture=viewport]").addEventListener("click", () => {
        activity = "Capturing viewport";
        send({ type: "capture", mode: "viewport" });
        render();
      });
      shadow.querySelector("[data-capture=region]").addEventListener("click", () => {
        selectingRegion = true;
        activity = "Drag a region in the app";
        render();
      });
      document.addEventListener("paste", (event) => {
        const file = Array.from(event.clipboardData && event.clipboardData.files || []).find((item) => item.type.startsWith("image/"));
        if (!file) return;
        event.preventDefault();
        attach(file, "paste");
      }, true);
      document.addEventListener("mouseover", (event) => {
        if (state.mode !== "annotate" || selectingRegion || isToolUiEvent(event) || !(event.target instanceof Element)) return;
        setBox(hoverBox, event.target.getBoundingClientRect());
      }, true);
      document.addEventListener("click", (event) => {
        const selection = window.getSelection();
        const preserveTextSelection = state.mode === "annotate"
          && Boolean(selection && !selection.isCollapsed && selection.toString().trim());
        const preserveClick = suppressNextClick || preserveTextSelection;
        suppressNextClick = false;
        const action = overlayEventAction(state.mode, isToolUiEvent(event), selectingRegion, preserveClick);
        if (action === "pass") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (action === "preserve") return;
        if (event.target instanceof Element) select(event.target, "", null);
      }, true);
      document.addEventListener("mouseup", (event) => {
        if (state.mode !== "annotate" || isToolUiEvent(event)) return;
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.anchorNode || selection.rangeCount === 0) return;
        const element = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
        if (!element || element.closest("[data-lavish-ui]")) return;
        select(element, selection.toString(), selection.getRangeAt(0).cloneRange());
        suppressNextClick = true;
        setTimeout(() => { suppressNextClick = false; }, 0);
      }, true);
      document.addEventListener("pointerdown", (event) => {
        if (overlayEventAction(state.mode, isToolUiEvent(event), selectingRegion) !== "region") return;
        regionStart = { x: event.clientX, y: event.clientY };
        setBox(regionBox, { left: event.clientX, top: event.clientY, width: 0, height: 0 });
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      document.addEventListener("pointermove", (event) => {
        if (!regionStart) return;
        const left = Math.min(regionStart.x, event.clientX);
        const top = Math.min(regionStart.y, event.clientY);
        setBox(regionBox, { left, top, width: Math.abs(event.clientX - regionStart.x), height: Math.abs(event.clientY - regionStart.y) });
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
        hideBox(regionBox);
        if (width > 0 && height > 0) {
          activity = "Capturing region";
          send({ type: "capture", mode: "region", region: { x: left, y: top, width, height } });
        } else {
          activity = "Region capture cancelled";
        }
        render();
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      window.addEventListener("resize", () => {
        dispatch({ type: "viewport", width: innerWidth });
        redrawSelection();
      });
      window.addEventListener("scroll", redrawSelection, true);

      window.__lavishInstalled = true;
      dispatch({ type: "viewport", width: innerWidth });
      send({ type: "ready" });
    };
    if (document.documentElement) install();
    else document.addEventListener("DOMContentLoaded", install, { once: true });
  })();`;
}

export const OVERLAY_SOURCE = createOverlaySource("lavish_preview_binding");
