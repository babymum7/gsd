function assistantMessages(events) {
  return events
    .filter((event) => event?.type === "message_end")
    .map((event) => event.message)
    .filter((message) => message?.role === "assistant");
}

function firstVisibleContent(message) {
  if (typeof message.content === "string") {
    return message.content.trim() === "" ? null : { type: "text", text: message.content };
  }
  if (!Array.isArray(message.content)) return null;
  return message.content.find((item) => item?.type !== "thinking") ?? null;
}

export function parseSkillComplianceEvents(rawEvents, expectedSkillPath) {
  if (typeof rawEvents !== "string") {
    return { ok: false, detail: "OMP JSON output must be a string" };
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
        pass: false,
        detail: `invalid NDJSON line ${index + 1}: ${error.message}`,
      };
    }
  }

  const messages = assistantMessages(events);
  if (messages.length === 0) {
    return { ok: true, pass: false, detail: "no assistant message_end event" };
  }

  let firstAction = null;
  for (const message of messages) {
    firstAction = firstVisibleContent(message);
    if (firstAction) break;
  }
  if (!firstAction) {
    return { ok: true, pass: false, detail: "no visible assistant action" };
  }

  if (firstAction.type === "text") {
    return {
      ok: true,
      pass: false,
      detail: `first visible action was text: ${String(firstAction.text ?? "").slice(0, 120)}`,
    };
  }

  if (firstAction.type !== "toolCall") {
    return {
      ok: true,
      pass: false,
      detail: `first visible action had unsupported content type ${firstAction.type}`,
    };
  }

  if (firstAction.name !== "read") {
    return {
      ok: true,
      pass: false,
      detail: `wrong tool ${firstAction.name}; expected read`,
    };
  }

  const path = firstAction.arguments?.path;
  if (typeof path !== "string" || path !== expectedSkillPath) {
    return {
      ok: true,
      pass: false,
      detail: `wrong path ${path ?? "missing"}; expected ${expectedSkillPath}`,
    };
  }

  return {
    ok: true,
    pass: true,
    detail: `first action read ${path}`,
  };
}
