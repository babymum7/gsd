import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(ROOT, "skills/gsd-prototyping/template");
const read = (relative) => readFileSync(join(TEMPLATE, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));

// The template is inert shipped data: these assertions read it with plain Node and
// never install or execute stylelint, style-dictionary, or Playwright.
const filesUnder = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function tokenLeaves(node, path = []) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [];
  if (Object.prototype.hasOwnProperty.call(node, "$value")) {
    return [{ name: path.join("."), token: node }];
  }
  return Object.entries(node).flatMap(([key, child]) => tokenLeaves(child, [...path, key]));
}

test("template tokens are DTCG-typed values", () => {
  for (const [file, expectedType] of [["tokens/color.json", "color"], ["tokens/dimension.json", "dimension"]]) {
    const leaves = tokenLeaves(json(file));
    assert.ok(leaves.length > 0, `${file} must declare at least one token`);
    for (const { name, token } of leaves) {
      assert.equal(typeof token.$value, "string", `${file}: ${name} declares $value`);
      assert.notEqual(token.$value.trim(), "", `${file}: ${name} $value is concrete`);
      assert.equal(token.$type, expectedType, `${file}: ${name} declares $type ${expectedType}`);
    }
  }
  // Dimension tokens carry both spacing and radius meaning, so the prototype never
  // needs a raw length for either.
  const dimensions = tokenLeaves(json("tokens/dimension.json")).map(({ name }) => name);
  assert.ok(dimensions.some((name) => name.startsWith("space.")), "spacing scale required");
  assert.ok(dimensions.some((name) => name.startsWith("radius.")), "radius scale required");
});

test("template stylelint config forbids raw color and spacing literals", () => {
  const config = json(".stylelintrc.json");
  assert.ok(
    config.plugins.includes("stylelint-declaration-strict-value"),
    "strict-value plugin must be enabled",
  );
  const strict = config.rules["scale-unlimited/declaration-strict-value"];
  assert.ok(Array.isArray(strict), "strict-value rule must declare its property list");
  const properties = strict[0];
  // Coverage, not literal membership: the plugin accepts `/regex/` entries, and the base
  // layer already uses logical longhands like `margin-block`, so a list naming only
  // `margin` would let a raw length through the lint the prototype loop depends on.
  const covered = (property) =>
    properties.some((entry) => {
      if (!entry.startsWith("/")) return entry === property;
      return new RegExp(entry.slice(1, entry.lastIndexOf("/"))).test(property);
    });
  for (const property of [
    "color",
    "background-color",
    "border-color",
    "outline-color",
    "padding",
    "padding-block",
    "padding-inline",
    "margin",
    "margin-block",
    "margin-inline",
    "gap",
    "row-gap",
    "column-gap",
    "border-radius",
    "border-start-start-radius",
    "font-size",
    "border-width",
    "border-top-width",
    "border-block-width",
    "outline-width",
    "outline-offset",
  ]) {
    assert.ok(covered(property), `strict-value must cover ${property}`);
  }
  // Bounded on purpose: `width`/`max-width` are layout percentages in a prototype, and a
  // keyword-only property like `border-style` has no token to demand.
  for (const property of ["width", "max-width", "border-style", "display"]) {
    assert.equal(covered(property), false, `strict-value must not cover ${property}`);
  }
  assert.equal(strict[1].ignoreValues.includes("transparent"), true, "bounded ignore list only");
  assert.ok(strict[1].ignoreValues.length <= 4, "ignore list stays bounded");
});

test("template check scripts split fast prototype loop from slow browser gate", () => {
  const pkg = json("package.json");
  const browser = /playwright|puppeteer|chromium|axe|percy/i;
  assert.equal(typeof pkg.scripts["check:fast"], "string");
  assert.doesNotMatch(pkg.scripts["check:fast"], browser, "check:fast stays browser-free");
  assert.match(pkg.scripts["check:fast"], /stylelint/, "check:fast lints tokens usage");
  assert.match(pkg.scripts["check:slow"], /playwright/, "check:slow runs the browser gate");
  // A bare directory argument is not a runnable target: `node --test primitives` resolves
  // it as a module and dies with MODULE_NOT_FOUND, so the shipped script must name a glob
  // that the runner expands to the primitive specs.
  const nodeTest = pkg.scripts["check:fast"].match(/node --test (\S+)/);
  assert.ok(nodeTest, "check:fast runs the primitive tests through node --test");
  assert.match(nodeTest[1], /\*/, "node --test target is a glob, not a bare directory");

  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be pinned exactly`);
  }
  for (const name of [
    "stylelint",
    "stylelint-declaration-strict-value",
    "style-dictionary",
    "@playwright/test",
  ]) {
    assert.ok(pkg.devDependencies[name], `${name} must be declared`);
  }
});

test("template token build emits CSS custom properties from DTCG sources", () => {
  const config = read("style-dictionary.config.js");
  assert.match(config, /tokens\/\*\*\/\*\.json/, "build reads the token sources");
  assert.match(config, /css\/variables/, "build emits custom properties");
  assert.match(config, /tokens\.css/, "build writes css/tokens.css");
  // style-dictionary@4 only reads `$value`/`$type` in DTCG mode. Auto-detection covers
  // imperatively passed tokens, so a file-sourced build states the flag explicitly or
  // silently emits nothing.
  assert.match(config, /usesDtcg:\s*true/, "file-sourced DTCG build sets usesDtcg");
});

test("template CSS carries no hardcoded color or length literals", () => {
  const stylesheets = filesUnder(TEMPLATE).filter((path) => path.endsWith(".css"));
  assert.ok(stylesheets.length > 0, "template must ship a base stylesheet");
  const offenders = [];
  const shorthands = [];
  for (const path of stylesheets) {
    const relative = path.slice(ROOT.length + 1);
    stripComments(readFileSync(path, "utf8")).split("\n").forEach((line, index) => {
      if (/#[0-9a-fA-F]{3,8}\b/.test(line) || /\b\d+(?:\.\d+)?(?:px|rem|em)\b/.test(line)) {
        offenders.push(`${relative}:${index + 1}`);
      }
      // `border: 2px solid red` and `border-top: 2px solid red` both pack a width, a
      // style, and a color into one declaration that strict-value cannot decompose, so
      // the template uses longhands only: every border/outline property it writes must
      // end in -width, -style, -color, -radius, or -offset.
      const property = line.match(/^\s*((?:border|outline)[a-z-]*)\s*:/);
      if (property && !/-(?:width|style|color|radius|offset)$/.test(property[1])) {
        shorthands.push(`${relative}:${index + 1} (${property[1]})`);
      }
    });
  }
  assert.deepEqual(offenders, []);
  assert.deepEqual(shorthands, [], "border/outline shorthands hide widths from strict-value");
  assert.match(read("css/base.css"), /var\(--/, "base layer consumes token custom properties");
});

test("template stylesheet layer is referenced by the token build", () => {
  assert.ok(existsSync(join(TEMPLATE, "css/base.css")), "css/base.css must exist");
  assert.match(read("css/base.css"), /@import|tokens\.css|:root|body/, "base layer is real CSS");
});

test("every template CSS custom property resolves to a declared token", () => {
  // A `var(--typo)` silently renders nothing, so the shipped base layer must only
  // reference properties style-dictionary actually emits from the token sources.
  const declared = new Set(
    ["tokens/color.json", "tokens/dimension.json"]
      .flatMap((file) => tokenLeaves(json(file)))
      .map(({ name }) => `--${name.split(".").join("-")}`),
  );
  const unresolved = [];
  for (const path of filesUnder(TEMPLATE).filter((file) => file.endsWith(".css"))) {
    const relative = path.slice(ROOT.length + 1);
    for (const match of stripComments(readFileSync(path, "utf8")).matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      if (!declared.has(match[1])) unresolved.push(`${relative}: ${match[1]}`);
    }
  }
  assert.deepEqual(unresolved, []);
});

test("template primitive is a light-DOM custom element consuming only tokens", () => {
  const source = read("primitives/button.js");
  assert.match(source, /customElements\.define\(\s*["'][a-z]+-[a-z-]+["']/, "registers a custom element");
  // A shadow root would hide the token layer imported by the page, so the primitive
  // must stay light-DOM and style itself through custom properties only.
  assert.doesNotMatch(source, /attachShadow|adoptedStyleSheets/, "primitive stays light-DOM");
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, "no literal color in the primitive");
  assert.doesNotMatch(source, /\b\d+(?:\.\d+)?(?:px|rem|em)\b/, "no literal length in the primitive");
  assert.ok(
    existsSync(join(TEMPLATE, "primitives/button.css")),
    "primitive ships its own token-only stylesheet",
  );
  assert.match(read("primitives/button.css"), /var\(--/, "primitive styles consume tokens");
});

test("template primitive test asserts rendered state without a browser", () => {
  const spec = read("primitives/button.test.js");
  assert.match(spec, /node:test/, "runs on the Node test runner");
  assert.doesNotMatch(spec, /playwright|puppeteer|chromium/i, "headless of any browser");
  // Registering a custom element needs a DOM, and the only dependency-free one here is
  // the minimal stub the spec builds itself.
  assert.match(spec, /assert\./, "asserts observable state");
  assert.match(spec, /disabled|aria-|textContent/, "asserts rendered element state");
  assert.match(spec, /click|dispatchEvent|addEventListener/, "asserts event behavior");
});

test("template surface documentation lists locked states and flows", () => {
  const doc = read("docs/surface-example.md");
  for (const heading of ["States", "Flows"]) {
    assert.match(doc, new RegExp(`^## ${heading}$`, "m"), `surface doc declares ${heading}`);
  }
  for (const state of ["empty", "loading", "error"]) {
    assert.match(doc, new RegExp(state, "i"), `surface doc names the ${state} state`);
  }
});

test("template interaction-rule ledger is a numbered system-wide rule set", () => {
  const ledger = read("docs/interaction-rules.md");
  assert.match(ledger, /^## Rules$/m, "ledger declares its canonical Rules section");

  // Each rule is addressable by a stable id so review feedback can cite it, and the ids
  // stay consecutive from 1 so appending a rule never collides or leaves a gap.
  const ids = [...ledger.matchAll(/^### IR-(\d+): (.+)$/gm)];
  assert.ok(ids.length >= 3, `ledger seeds at least three rules, got ${ids.length}`);
  assert.deepEqual(
    ids.map(([, id]) => Number(id)),
    ids.map((_, index) => index + 1),
    "IR ids are unique and consecutive from 1",
  );
  for (const [, id, title] of ids) {
    assert.ok(title.trim().length > 0, `IR-${id} has a title`);
  }

  // A rule is only enforceable when it names an observable trigger and the behavior that
  // trigger requires; prose without both is a preference, not a rule.
  const bodies = ledger.split(/^### IR-\d+: .+$/m).slice(1);
  for (const [index, body] of bodies.entries()) {
    assert.match(body, /^- \*\*Trigger:\*\* .+$/m, `IR-${index + 1} names an observable trigger`);
    assert.match(body, /^- \*\*Behavior:\*\* .+$/m, `IR-${index + 1} names the required behavior`);
  }

  // The two example rules the user named must ship seeded, since they are the reason the
  // ledger exists: they constrain every comparable surface, not one screen.
  assert.match(ledger, /empty[\s\S]{0,120}search[\s\S]{0,200}no (?:results |suggestion )?dropdown/i);
  assert.match(ledger, /preload|prefetch/i);

  // The template ships no nested agent contract, so `DESIGN.md` is the file that must
  // point at the ledger.
  assert.match(read("DESIGN.md"), /docs\/interaction-rules\.md/, "DESIGN.md references the ledger");

  // The ledger travels: its rules constrain any comparable surface in any project, so it
  // must never name this product, its domain, or one specific screen.
  assert.match(ledger, /(?:product-neutral|any project|another project|portable)/i);
});

// `css/tokens.css` is written by `npm run tokens`, so it is a declared build output
// rather than a shipped file. `AGENTS.md` is the repository-root agent contract, which
// deliberately lives outside this directory. Everything else `DESIGN.md` names must exist.
const EXTERNAL = new Set(["css/tokens.css", "AGENTS.md"]);
const PATH_EXTENSIONS = new Set(["md", "json", "js", "css"]);

test("every repository path referenced by template instructions exists", () => {
  // Instruction files are the handoff surface for any agent editing design/, so a
  // referenced path that does not exist is a broken contract, not a typo.
  const unresolved = [];
  for (const file of ["DESIGN.md"]) {
    for (const match of read(file).matchAll(/`([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`/g)) {
      // A backticked dotted identifier like `customElements.define` is code, not a path.
      const target = match[1].replace(/^design\//, "");
      const extension = target.slice(target.lastIndexOf(".") + 1);
      if (!PATH_EXTENSIONS.has(extension)) continue;
      if (EXTERNAL.has(target)) continue;
      if (!existsSync(join(TEMPLATE, target))) unresolved.push(`${file}: ${target}`);
    }
  }
  assert.deepEqual(unresolved, []);
});

test("template instruction files state the design standard obligations", () => {
  // A nested agent contract would compete with the repository-root `AGENTS.md`, which is
  // the only file an agent reads for instructions.
  assert.equal(existsSync(join(TEMPLATE, "AGENTS.md")), false, "template ships no nested agent contract");

  const design = read("DESIGN.md");
  assert.match(design, /token/i, "requires token use");
  assert.match(design, /(?:component|primitive)/i, "requires component extraction");
  assert.match(design, /check:fast[\s\S]{0,400}check:slow/, "states the fast and slow split");
  // Clean architecture is the point: this file is written to be supplied as tool context,
  // and it records the configuration this repository sets rather than any tool habit —
  // working directory at the repository root, the meta directory that contains the agent
  // session, generated files targeted at this directory, and a run that writes files
  // instead of returning one inline artifact block.
  assert.match(design, /supplied as context/i);
  assert.match(design, /working directory[\s\S]{0,140}repository root/i);
  assert.match(design, /meta directory[\s\S]{0,160}`design\/`/i);
  assert.doesNotMatch(design, /working directory is set to the repository root, so its agent reads/i);
  assert.match(design, /generated[\s\S]{0,120}`design\/`/i);
  assert.match(design, /writes? files[\s\S]{0,200}inline artifact/i);
  assert.match(design, /single[- ]file[\s\S]{0,240}(?:decompose|split)/i);
  assert.match(design, /like a real app|as a real app/i);
  // The obligations are reusable: nothing in them may name this product, its domain, one
  // specific screen, or one component framework, so another project adopts them unchanged.
  assert.match(design, /(?:product-neutral|any project|another project|portable)/i);
  assert.match(design, /framework[- ]neutral|framework[- ]agnostic/i);
  // Light-DOM custom elements are how this dependency-free web template satisfies the
  // component obligation, so the document must mark them as mechanics, not as the rule.
  assert.match(design, /light[- ]DOM/i, "the template's own mechanics are still recorded");
  assert.match(
    design,
    /mechanic[\s\S]{0,400}light[- ]DOM/i,
    "light-DOM is presented as this template's mechanics",
  );
  assert.match(design, /component framework[\s\S]{0,160}(?:swap|instead)/i);
});
