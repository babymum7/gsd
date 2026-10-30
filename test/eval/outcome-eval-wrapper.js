// The GSD arm's only extension in the outcome benchmark (decision 0044). It loads the omp adapter
// named in its config and appends one line to the evidence file for every outgoing request whose
// messages carry the rendered bootstrap, because omp's JSON events never show injected context.
// The config sits beside this file under the same name with a .json extension. omp imports this
// file with an `?mtime=` query on its URL, so the name comes from the path, which drops it.
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const config = JSON.parse(readFileSync(fileURLToPath(import.meta.url).replace(/\.js$/, ".json"), "utf8"));
const adapterUrl = pathToFileURL(config.adapter);
const adapter = await import(adapterUrl.href);
const { messageContainsBootstrap } = await import(new URL("../../lib/gsd-bootstrap.mjs", adapterUrl).href);

function recordInjections(handler) {
  return async (event, ctx) => {
    const result = await handler(event, ctx);
    const messages = result?.messages ?? event?.messages ?? [];
    // A bootstrap-error payload does not match, so a session that lost GSD leaves no evidence.
    if (messages.some((message) => messageContainsBootstrap(message))) {
      appendFileSync(config.evidence, `${JSON.stringify({ at: Date.now() })}\n`);
    }
    return result;
  };
}

export default function outcomeEvalWrapper(pi) {
  const host = new Proxy(pi, {
    get(target, property) {
      if (property === "on") {
        return (eventName, handler) => target.on(eventName, eventName === "context" ? recordInjections(handler) : handler);
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  adapter.default(host);
}
