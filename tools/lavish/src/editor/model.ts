export type EditorMode = "interact" | "annotate";
export type AgentPresence = "offline" | "listening" | "working";

export interface EditorAnchor {
  [key: string]: string;
}

export interface EditorAttachment {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  source: "upload" | "paste" | "viewport" | "region";
}

export interface EditorDraft {
  draftId: string;
  createdAt: string;
  comment: string;
  anchor: EditorAnchor | null;
  attachments: EditorAttachment[];
}

export interface EditorDelivery {
  cursor: number;
  deliveryId: string;
  createdAt: string;
  items: EditorDraft[];
}

export interface EditorReply {
  id: number;
  createdAt: string;
  text: string;
}

export interface EditorHistoryEntry {
  id: string;
  role: "human" | "agent";
  createdAt: string;
  text: string;
  anchor: EditorAnchor | null;
  attachments: EditorAttachment[];
}

export interface EditorState {
  mode: EditorMode;
  collapsed: boolean;
  narrow: boolean;
  presence: AgentPresence;
  composer: string;
  anchor: EditorAnchor | null;
  attachments: EditorAttachment[];
  drafts: EditorDraft[];
  history: EditorHistoryEntry[];
  sending: boolean;
  error: string | null;
}

export type EditorEvent =
  | { type: "mode"; mode: EditorMode }
  | { type: "toggle-collapsed" }
  | { type: "viewport"; width: number }
  | { type: "presence"; presence: AgentPresence }
  | { type: "compose"; value: string }
  | { type: "select"; anchor: EditorAnchor | null }
  | { type: "attach"; attachment: EditorAttachment }
  | { type: "remove-attachment"; attachmentId: string }
  | { type: "drafts"; drafts: EditorDraft[] }
  | { type: "queue"; draftId: string; createdAt: string }
  | { type: "remove-draft"; draftId: string }
  | { type: "send"; deliveryId: string; currentDraftId: string; createdAt: string }
  | { type: "sent"; delivery: EditorDelivery }
  | { type: "reply"; reply: EditorReply }
  | { type: "hydrate"; drafts: EditorDraft[]; deliveries: EditorDelivery[]; replies: EditorReply[] }
  | { type: "error"; message: string | null }
  | {
      type: "key";
      key: string;
      shiftKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      draftId: string;
      deliveryId: string;
      createdAt: string;
    };

export type EditorEffect =
  | { type: "prevent-default" }
  | { type: "queue"; draft: EditorDraft }
  | { type: "remove"; draftId: string }
  | { type: "send"; deliveryId: string; current: EditorDraft | null };

export interface EditorTransition {
  state: EditorState;
  effects: EditorEffect[];
}

function draftFromComposer(state: EditorState, draftId: string, createdAt: string): EditorDraft | null {
  const comment = state.composer.trim();
  if (!comment && state.attachments.length === 0) return null;
  return {
    draftId,
    createdAt,
    comment,
    anchor: state.anchor,
    attachments: state.attachments,
  };
}

function deliveryEntries(delivery: EditorDelivery): EditorHistoryEntry[] {
  return delivery.items.map((item, index) => ({
    id: `${delivery.deliveryId}:${index}`,
    role: "human" as const,
    createdAt: item.createdAt || delivery.createdAt,
    text: item.comment,
    anchor: item.anchor,
    attachments: item.attachments,
  }));
}

function replyEntry(reply: EditorReply): EditorHistoryEntry {
  return {
    id: `reply:${reply.id}`,
    role: "agent",
    createdAt: reply.createdAt,
    text: reply.text,
    anchor: null,
    attachments: [],
  };
}

function orderedHistory(deliveries: EditorDelivery[], replies: EditorReply[]): EditorHistoryEntry[] {
  return [
    ...deliveries.flatMap(deliveryEntries),
    ...replies.map(replyEntry),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function createEditorState(): EditorState {
  return {
    mode: "interact",
    collapsed: false,
    narrow: false,
    presence: "offline",
    composer: "",
    anchor: null,
    attachments: [],
    drafts: [],
    history: [],
    sending: false,
    error: null,
  };
}

export function reduceEditor(state: EditorState, event: EditorEvent): EditorTransition {
  if (event.type === "mode") return { state: { ...state, mode: event.mode, error: null }, effects: [] };
  if (event.type === "toggle-collapsed") {
    return { state: { ...state, collapsed: !state.collapsed }, effects: [] };
  }
  if (event.type === "viewport") {
    return { state: { ...state, narrow: event.width < 640 }, effects: [] };
  }
  if (event.type === "presence") {
    return { state: { ...state, presence: event.presence }, effects: [] };
  }
  if (event.type === "compose") {
    return { state: { ...state, composer: event.value.slice(0, 20_000), error: null }, effects: [] };
  }
  if (event.type === "select") {
    return { state: { ...state, anchor: event.anchor, error: null }, effects: [] };
  }
  if (event.type === "attach") {
    if (state.attachments.some((attachment) => attachment.id === event.attachment.id)) {
      return { state, effects: [] };
    }
    return { state: { ...state, attachments: [...state.attachments, event.attachment], error: null }, effects: [] };
  }
  if (event.type === "remove-attachment") {
    return {
      state: {
        ...state,
        attachments: state.attachments.filter((attachment) => attachment.id !== event.attachmentId),
      },
      effects: [],
    };
  }
  if (event.type === "drafts") {
    return { state: { ...state, drafts: event.drafts, error: null }, effects: [] };
  }
  if (event.type === "queue") {
    const draft = draftFromComposer(state, event.draftId, event.createdAt);
    if (!draft) {
      return { state: { ...state, error: "Add a comment or image before queueing." }, effects: [] };
    }
    return {
      state: {
        ...state,
        composer: "",
        anchor: null,
        attachments: [],
        drafts: [...state.drafts, draft],
        error: null,
      },
      effects: [{ type: "queue", draft }],
    };
  }
  if (event.type === "remove-draft") {
    if (!state.drafts.some((draft) => draft.draftId === event.draftId)) return { state, effects: [] };
    return {
      state: { ...state, drafts: state.drafts.filter((draft) => draft.draftId !== event.draftId) },
      effects: [{ type: "remove", draftId: event.draftId }],
    };
  }
  if (event.type === "send") {
    if (state.sending) return { state, effects: [] };
    const current = draftFromComposer(state, event.currentDraftId, event.createdAt);
    if (!current && state.drafts.length === 0) {
      return { state: { ...state, error: "Queue or write feedback before sending." }, effects: [] };
    }
    return {
      state: { ...state, sending: true, error: null },
      effects: [{ type: "send", deliveryId: event.deliveryId, current }],
    };
  }
  if (event.type === "sent") {
    const known = new Set(state.history.map((entry) => entry.id));
    const appended = deliveryEntries(event.delivery).filter((entry) => !known.has(entry.id));
    return {
      state: {
        ...state,
        composer: "",
        anchor: null,
        attachments: [],
        drafts: [],
        history: [...state.history, ...appended],
        sending: false,
        error: null,
      },
      effects: [],
    };
  }
  if (event.type === "reply") {
    const entry = replyEntry(event.reply);
    if (state.history.some((item) => item.id === entry.id)) return { state, effects: [] };
    return { state: { ...state, history: [...state.history, entry] }, effects: [] };
  }
  if (event.type === "hydrate") {
    return {
      state: {
        ...state,
        drafts: event.drafts,
        history: orderedHistory(event.deliveries, event.replies),
        sending: false,
        error: null,
      },
      effects: [],
    };
  }
  if (event.type === "error") return { state: { ...state, error: event.message, sending: false }, effects: [] };
  if (event.type === "key") {
    if (event.key !== "Enter" || event.shiftKey) return { state, effects: [] };
    const action = event.ctrlKey || event.metaKey
      ? reduceEditor(state, {
          type: "send",
          deliveryId: event.deliveryId,
          currentDraftId: event.draftId,
          createdAt: event.createdAt,
        })
      : reduceEditor(state, { type: "queue", draftId: event.draftId, createdAt: event.createdAt });
    return { state: action.state, effects: [{ type: "prevent-default" }, ...action.effects] };
  }
  return { state, effects: [] };
}

export const EDITOR_MODEL_RUNTIME = [
  `const draftFromComposer = ${draftFromComposer.toString()};`,
  `const deliveryEntries = ${deliveryEntries.toString()};`,
  `const replyEntry = ${replyEntry.toString()};`,
  `const orderedHistory = ${orderedHistory.toString()};`,
  `const createEditorState = ${createEditorState.toString()};`,
  `const reduceEditor = ${reduceEditor.toString()};`,
].join("\n");
