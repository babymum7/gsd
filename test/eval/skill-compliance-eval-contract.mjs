// A skill is "reached" when the model reads its SKILL.md within its first few tool calls and
// before it answers in text. Routing is suggestive, so a model may orient itself first; what
// this axis rejects is answering, or wandering past the budget, without the skill.
export const MAX_ACTIONS = 3;

function assistantMessages(events) {
  return events
    .filter((event) => event?.type === "message_end")
    .map((event) => event.message)
    .filter((message) => message?.role === "assistant");
}

function visibleContent(message) {
  if (typeof message.content === "string") {
    return message.content.trim() === "" ? [] : [{ type: "text", text: message.content }];
  }
  if (!Array.isArray(message.content)) return [];
  return message.content.filter((item) => item && item.type !== "thinking");
}

function describeAction(action) {
  const target = action.arguments?.path ?? action.arguments?.command ?? "";
  return target ? `${action.name} ${target}` : String(action.name);
}

// `decided` tells a streaming runner it may stop the session: a pass, a text answer, or an
// exhausted action budget cannot change with later events.
export function parseSkillComplianceEvents(rawEvents, expectedSkillPath) {
  if (typeof rawEvents !== "string") {
    return { ok: false, decided: true, pass: false, detail: "OMP JSON output must be a string" };
  }

  const events = [];
  for (const [index, line] of rawEvents.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch (error) {
      return {
        ok: true,
        decided: true,
        pass: false,
        detail: `invalid NDJSON line ${index + 1}: ${error.message}`,
      };
    }
  }

  const messages = assistantMessages(events);
  if (messages.length === 0) {
    return { ok: true, decided: false, pass: false, detail: "no assistant message_end event" };
  }

  const actions = [];
  for (const message of messages) {
    const visible = visibleContent(message);
    const calls = visible.filter((item) => item.type === "toolCall");
    for (const call of calls) {
      actions.push(call);
      if (call.name === "read" && call.arguments?.path === expectedSkillPath) {
        return {
          ok: true,
          decided: true,
          pass: true,
          detail: `reached ${expectedSkillPath} at action ${actions.length}`,
        };
      }
      if (actions.length >= MAX_ACTIONS) {
        return {
          ok: true,
          decided: true,
          pass: false,
          detail: `skill not read in the first ${MAX_ACTIONS} actions: ${actions.map(describeAction).join(", ")}`,
        };
      }
    }
    const text = visible.find((item) => item.type === "text" && String(item.text ?? "").trim());
    if (calls.length === 0 && text) {
      return {
        ok: true,
        decided: true,
        pass: false,
        detail: `answered before reading the skill: ${String(text.text).slice(0, 120)}`,
      };
    }
  }

  return {
    ok: true,
    decided: false,
    pass: false,
    detail: actions.length
      ? `skill not read before the session ended: ${actions.map(describeAction).join(", ")}`
      : "no visible assistant action",
  };
}
