# Interaction rules

System-wide rules that constrain every comparable surface in this prototype. A rule
lands here only when it holds beyond the surface that produced it; a decision about one
screen stays in that screen's document under `docs/`.

Each rule keeps its `IR-<n>` id forever, so review feedback and surface docs can cite
it. Append a new rule with the next id; never renumber or reuse an id. A rule needs an
observable trigger and the behavior that trigger requires, because a rule nobody can
check by using the prototype is a preference.

These rules are product-neutral: a rule names an interaction pattern, never this
product, its domain language, or one specific screen. That is what makes the ledger
portable, so another project can adopt this file unchanged and append its own rules.
A rule that only makes sense here belongs in a surface document instead.

## Rules

### IR-1: An empty search input shows no suggestion dropdown

- **Trigger:** A search or combobox input holds no user-typed characters, including
  after clearing it.
- **Behavior:** No suggestion dropdown, results panel, or overlay renders. The input
  stays a plain field until the first character arrives.
- **Reason:** An empty query has nothing to rank, so a dropdown covers the page with
  results the user never asked for.

### IR-2: A search input preloads the common related data it will need

- **Trigger:** A surface renders a search input whose result set has a small, known
  common subset, such as recent selections or the top entries of a short list.
- **Behavior:** That subset loads with the surface, so the first keystroke filters
  already-present data instead of waiting on a request. Only queries outside the
  preloaded subset reach the network.
- **Reason:** The perceived speed of a search input is set by its first keystroke;
  paying that cost during surface load removes the visible wait entirely.

### IR-3: Every destructive action states its exact target before it runs

- **Trigger:** A control deletes, revokes, or overwrites data the user cannot recover
  by undoing.
- **Behavior:** The confirmation names the exact target and the irreversible effect,
  and the confirming control carries the verb, not a generic `OK`.
- **Reason:** A generic confirmation trains users to dismiss it, which makes the
  guard decorative.

### IR-4: A slow action reports progress on the control that started it

- **Trigger:** An action the user triggered has not resolved within roughly one frame
  of interaction feedback.
- **Behavior:** The originating control shows busy state and stays visible, so the
  page never swaps to a full-surface spinner that loses the user's position.
- **Reason:** Feedback belongs where attention already is, and preserving position
  keeps the surface readable while the action completes.

### IR-5: Every failure keeps the user's input and names the next action

- **Trigger:** A request or validation fails after the user entered data.
- **Behavior:** The entered values stay in the form, the message names what failed,
  and one control retries or corrects it.
- **Reason:** Discarding input turns a recoverable failure into repeated work, and a
  message with no next action leaves the surface stuck.
