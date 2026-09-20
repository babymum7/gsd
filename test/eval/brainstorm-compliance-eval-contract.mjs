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

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function verdict(pass, detail) {
  return { ok: true, pass, detail };
}

export function parseBrainstormComplianceEvents(rawEvents, expectedSkillPath) {
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
      return verdict(false, `invalid NDJSON line ${index + 1}: ${error.message}`);
    }
  }

  const messages = assistantMessages(events);
  if (messages.length === 0) {
    return verdict(false, "no assistant message_end event");
  }

  let firstAction = null;
  for (const message of messages) {
    firstAction = firstVisibleContent(message);
    if (firstAction) break;
  }
  if (!firstAction) {
    return verdict(false, "no visible assistant action");
  }
  if (firstAction.type === "text") {
    return verdict(false, `first visible action was text: ${String(firstAction.text ?? "").slice(0, 120)}`);
  }
  if (firstAction.type !== "toolCall") {
    return verdict(false, `first visible action had unsupported content type ${firstAction.type}`);
  }
  if (firstAction.name !== "read") {
    return verdict(false, `wrong tool ${firstAction.name}; expected read`);
  }
  const firstPath = firstAction.arguments?.path;
  if (firstPath !== expectedSkillPath) {
    return verdict(false, `wrong path ${firstPath ?? "missing"}; expected ${expectedSkillPath}`);
  }

  const toolCalls = messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((item) => item?.type === "toolCall");
  if (toolCalls.length !== 1) {
    return verdict(false, "no tool call may follow the required skill read");
  }

  const responseTexts = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const item of message.content) {
      if (item?.type === "text" && nonEmptyString(item.text)) responseTexts.push(item.text.trim());
    }
    if (typeof message.content === "string" && message.content.trim() !== "") {
      responseTexts.push(message.content.trim());
    }
  }
  const responseText = responseTexts.at(-1);
  if (!responseText) {
    return verdict(false, "no post-read text response");
  }

  let value;
  try {
    value = JSON.parse(responseText);
  } catch (error) {
    return verdict(false, `post-read response is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return verdict(false, "post-read response must be a JSON object");
  }

  const keys = Object.keys(value).sort();
  const expectedKeys = ["approaches", "implementationStarted", "question", "recommendedAnswer"];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    return verdict(false, `post-read response keys must be exactly ${expectedKeys.join(", ")}`);
  }
  if (typeof value.implementationStarted !== "boolean") {
    return verdict(false, "implementationStarted must be boolean");
  }
  if (value.implementationStarted) {
    return verdict(false, "implementationStarted must be false");
  }

  const hasQuestion = value.question !== null;
  const hasRecommendedAnswer = value.recommendedAnswer !== null;
  if (hasQuestion !== hasRecommendedAnswer) {
    return verdict(false, "question and recommendedAnswer must both be null or both be non-null");
  }
  if (hasQuestion) {
    if (!nonEmptyString(value.question) || !nonEmptyString(value.recommendedAnswer)) {
      return verdict(false, "question and recommendedAnswer must be non-empty strings");
    }
    return verdict(true, "recommended question");
  }

  if (!Array.isArray(value.approaches)) {
    return verdict(false, "approaches must be an array");
  }
  if (value.approaches.length < 2) {
    return verdict(false, "without a question, at least 2 approaches are required");
  }
  let recommendations = 0;
  for (const [index, approach] of value.approaches.entries()) {
    if (!approach || typeof approach !== "object" || Array.isArray(approach)) {
      return verdict(false, `approach ${index + 1} must be an object`);
    }
    if (!nonEmptyString(approach.name) || !nonEmptyString(approach.tradeoffs)) {
      return verdict(false, `approach ${index + 1} needs non-empty name and tradeoffs`);
    }
    if (typeof approach.recommended !== "boolean") {
      return verdict(false, `approach ${index + 1} recommended must be boolean`);
    }
    recommendations += approach.recommended ? 1 : 0;
  }
  if (recommendations !== 1) {
    return verdict(false, `exactly one approach must be recommended; found ${recommendations}`);
  }
  return verdict(true, `${value.approaches.length} approaches with one recommendation`);
}
