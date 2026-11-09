# CLAUDE.md — HTML prototype template

Purpose: build clickable HTML prototypes that show real look & feel and basic behavior, so reviewers can approve before handoff to dev. This is not production code: no backend, no build step, no framework.

## Run

Double-click `index.html`. No server needed. Everything must keep working from `file://`.

## Structure

```
prototype/
├── CLAUDE.md        team rules (this file)
├── README.md        how to open, mock data shapes, AI setup
├── tokens.css       colors, gradients, typography, spacing — single source of truth
├── components/      reusable CSS (button, card, form, table, modal) + ui.js + ai.js
└── index.html       entry screen / starter example
```

New screens go in the repo root as `<screen-name>.html` and are linked from `index.html`. If a feature needs several screens, group them in `flows/<flow-name>/` (`01-…html`, `02-…html`) and ask first.

## Rules

1. **Tokens only.** Never write hex, rgb, or gradient values outside `tokens.css`. Use `var(--c-…)` for color and `var(--g-…)` for gradients. If no token fits, ask. Do not invent colors.
2. **Do not edit `tokens.css`** unless explicitly told to. Token changes are versioned by the design system.
3. **Reuse before creating.** Check `components/` first. A new component = `components/<name>.css` + one `@import` in `components/index.css`. No repeated page-specific styles.
4. **Light and dark must both work.** Toggle the theme and check every screen before calling it done.
5. **Vanilla HTML/CSS/JS only, `file://`-safe.** No frameworks, npm, build tools, CDN scripts, or remote fonts and images. No `fetch` for local files and no `import` / `type="module"` (both break on `file://`). Load everything with plain `<script src>` and `<link>`, with `ui.js` in `<head>` and page scripts at the end of `<body>`.
6. **Mock data is inline.** Put it in one `const MOCK = { ... }` block at the bottom of the screen's HTML, never scattered through markup. Use the field names and shapes in `README.md`, and add new entities there. Fake data only, never real customer or employee data.
7. **Semantic HTML.** Use `<button>`, `<a>`, `<label>`, `<dialog>`. Focus must be visible. Layout must work down to mobile width.
8. **Show real states.** Every data or AI view needs loading, empty, and error states, not only the happy path.

## Tokens

- Naming: `--c-<identifier>` for colors and `--g-<identifier>` for gradients. Identifiers keep the design-system casing (`--c-bTxt-primary`, `--g-aiGen-still`).
- Light values are in `:root`. Dark overrides are in `[data-theme="dark"]`. Tokens identical in both modes are defined once in `:root`.
- `--c-solid-*` are mode-independent. Never override them for dark mode.
- `brand*` tokens: text, shape, stroke only. **Never as a fill**, and do not overuse. `indigo-*`: rare spotlight only.
- AI surfaces use `--c-sevPurple`, `--c-lighPurple` (spelling matches the source), and `--g-aiGen-*`. `aiGen-multiAnim-A…D` are only for a cycled animation.
- **Do not use** tokens marked `[TBR]`, `[TBC]`, `[LEGACY]`, or `[EXPERIMENTAL]` in `tokens.css`. If one is required, ask.
- Typography, spacing, radius, and motion values in `tokens.css` are **placeholders** (not from colors.pdf). Usable, but not final.

## Naming

- Files, folders, classes: `kebab-case`. Light BEM: `.card`, `.card--done`, `.modal__body`.
- Status vocabulary: `ok` / `warn` / `err` / `neutral` (e.g. `.badge--ok`).

## UI copy

- English, sentence case, active voice. Buttons say what happens: "Save changes", not "Submit".
- Keep one name per action across a flow. Errors say what went wrong and how to fix it. They do not apologize.

## AI integration (OpenRouter, Claude API, LM Studio, local server)

- All LLM calls go through `components/ai.js` (global `AI`). Never call `fetch` to a model API from a page, and never hardcode a key.
- Include it with `<script src="components/ai.js"></script>`. In the **AI settings** dialog (`AI.mountSettings(button)`), the user picks a provider, then the key (optional for local servers), server URL (local servers only), model and small model. Everything is stored in `localStorage` only. Never hardcode a provider URL in a page. If a screen needs to know the provider, read `AI.settings.provider` / `AI.settings.baseUrl`.
- Providers:
  - **OpenRouter**
  - **Claude API**: Anthropic's own API. Only the key is entered; URL, API version and browser headers are preset in `ai.js`.
  - **LM Studio**
  - **Other local server** (OpenAI-compatible)

  Pages are the same for all four. `ai.js` translates `tier`, `reasoning`, `schema` and the usage log for each provider.
- This is for prototypes only. A browser-held key is not acceptable in production. Dev will move calls behind a backend.

### Every call: label and tier

Each call passes `label` and `tier`. `ai.js` has fallbacks (`large`, label taken from the caller), but they exist so old screens keep working. Don't rely on them.

```js
const plan = await AI.json(messages, { label: "trip:plan", tier: "large", schema: PLAN_SCHEMA });
const text = await AI.chat(messages, { label: "trip:summary", tier: "small", onToken });
```

- **`label`**: `"<screen>:<task>"`, e.g. `"entry:gap-check"`. The usage log groups calls by label, so one task gets one label.
- **`tier`**: which model runs the call. Do not hardcode a model name in a page.
  - `small` (`AI.settings.smallModel`): classify, detect language, extract fields, rewrite or translate, short labels, write search queries, yes/no checks. Defaults: `anthropic/claude-haiku-5.5` on OpenRouter, `claude-haiku-5-5` on the Claude API.
  - `large` (`AI.settings.model`): multi-step reasoning, planning, long documents, research synthesis, anything the user reads as the main result. Defaults: `anthropic/claude-sonnet-5.5` on OpenRouter, `claude-opus-5-5` on the Claude API.
  - Start with `small`. Move a call to `large` only after you have seen `small` fail on it, and note why in the screen's `<!-- notes -->`.
  - Pass `{ model }` only when a screen truly needs one specific model.
- **`maxTokens`**: a runaway guard, not a length budget. The default is 8192 (`DEFAULT_MAX_TOKENS`). Billing counts only the tokens the model writes, and the model never sees this number. A low ceiling doesn't make answers shorter; it cuts them off, and the cut-off text is paid for and wasted. Don't lower it to control length. Raise it only for a call that truly writes more than about 6,000 tokens.
- **`reasoning`** (thinking): `"none"` | `"minimal"` | `"low"` | `"medium"` | `"high"`. Defaults: `none` for `small`, `low` for `large`. Reasoning tokens are billed as output and count toward `maxTokens`. Raise it for one call only after you have seen it fail with less, and note why in `<!-- notes -->`. If a model can't turn reasoning off, `ai.js` drops the setting by itself. Local servers ignore it.

  On the Claude API, `ai.js` maps `reasoning` to Claude's `thinking` and `output_config.effort`:

  | `reasoning` | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
  |---|---|---|---|
  | `none` | thinking off | thinking off (`between_tools`) | thinking can't be turned off, so effort `low` |
  | `minimal` | effort `low` | effort `low` | effort `low` |
  | other values | effort of the same name | effort of the same name | effort of the same name |

### Controlling length

Control length in the prompt and the schema, never with `maxTokens`:

- Give exact counts ("exactly 4 categories, 2–3 topics each"), and in the schema set `maxItems` on arrays.
- Give a word limit per field ("label: 2–5 words", "detail: one sentence, at most 20 words").
- Ask only for fields the screen shows. Every extra field is output you pay for.
- For a big structure, split the work into one call per part, and only when each part is independent.

### Structured output

- Use `AI.json(messages, { schema })` whenever code reads the answer. It asks the provider for that JSON shape (`response_format`) and returns the parsed object. Don't parse model text with regex in a page.
- Schema rules (so strict mode works on every provider): an object at the root, `additionalProperties: false` on every object, every property listed in `required`, `enum` for fixed values. Use at most 3 levels of nesting. Use ids the page gave the model, never free text that must match exactly.
- Don't paste the schema into the prompt as well. If a provider doesn't support `response_format`, `ai.js` adds the schema to the prompt by itself.
- Use `AI.chat` for prose the user reads, and stream it with `onToken`.

### Calls per action

- One user action = one call when possible, three at most. A new call must do work the previous one could not.
- Don't call the model in the background (on typing, on a timer, after every change) without asking first.
- Do deterministic work in code: counting, sorting, dedup, checking ids, language detection by script.

### Retries and timeouts (hard limits)

- **Cut off (`length`)**: `ai.js` asks the model once to continue where it stopped, then joins the two parts. It doesn't start over, so the text already written is kept. If the answer is still cut off, or the joined JSON doesn't parse, the call throws `TRUNCATED` or `BAD_JSON`. Show the error state. Don't add another retry in the page.
- **Timeout**: never retry. A slow call is usually a big call, and repeating it pays twice. Abort the request (pass a `signal`) so it stops costing, then show the error state with a **Try again** button the user presses.
- **Transient errors** (429, 5xx, network): retry with backoff, up to 3 times. These failed requests cost nothing.
- So per user action, a call runs at most twice for a cut-off answer and never repeats after a timeout. Anything more is a bug.

### Prompts

- Prompts live next to the screen that uses them: a short system message with the rules, and a user message with the data. No secrets in prompts.
- Send only the data the task needs (ids and labels, not whole objects or the full history). Keep prompts short and positive, and don't stack "IMPORTANT" rules. Small models follow 5 clear rules better than 30.

### Errors

Handle by `e.code`:

- `NO_KEY` → open the settings dialog.
- `NO_MODEL`, `HTTP`, `NETWORK` → show `e.message` in a `.banner`.
- `TRUNCATED` → still cut off after the automatic continuation; `e.text` holds the partial text. Show the error state. The fix is a shorter request (see Controlling length) or less `reasoning`, not a retry.
- `BAD_JSON` → `AI.json` got no valid JSON; `e.text` holds the raw text. Show the error state.

Before a web search, check `AI.canSearch()` (false when search is off, the default with a local provider). A search costs a model call plus search fees, so give it its own `label`. Keep the default of 5 results (don't pass `maxResults`). More results mean more input tokens on every call that reads them, and on the OpenRouter web plugin each result is billed too. With the Claude API, "Claude web search" runs at most 2 searches per lookup ($10 per 1,000 searches plus the result tokens), and `maxResults` doesn't apply.

### Enforced by the project settings

- `.claude/settings.json` blocks Claude from editing `components/ai.js`. Changes to the harness are made on purpose by a person, not as part of building a screen.
- After every edit to an `.html` file, `.claude/hooks/check-ai.js` checks the AI rules: no `fetch` to model APIs, no hardcoded model ids, `label` and `tier` on every call, no `maxTokens` under 2000. Fix what it reports. If a line is intentional, put `// ai-lint-ignore: <reason>` on the line above it.
- To run the check by hand: `node .claude/hooks/check-ai.js <file>.html`.

### Measure before you optimize

`ai.js` logs every call (label, tier, model, input/output/reasoning/cached tokens, cost, time, finish reason) to the console. If `reasoning` is most of `output`, lower `reasoning` before you touch the prompt. Session totals are shown in **AI settings → Usage this session**. Run `AI.usageReport()` in the console for a per-label table.

## Workflow for a new screen

1. Read the request. If the requirement is unclear, ask before guessing.
2. Reuse components and tokens. Create a new component only when nothing fits.
3. Build with an inline `MOCK` block, using the shapes in `README.md`.
4. Verify by opening the file directly (`file://`): light and dark, keyboard focus, narrow width, all links work, no console errors, and
   `grep -rnE "#[0-9A-Fa-f]{3,8}\b|rgba?\(" --include=*.html --include=*.css --exclude=tokens.css .` returns nothing.
   For AI screens, also run the main flow once and check `AI.usageReport()`:
   - every call has a real label (not `auto:…`)
   - no `length` finish reasons
   - no label is called more often than the flow needs
5. Note decisions and open questions in the screen's `<!-- notes -->` block or the flow's `FLOW.md`.

## Handoff summary (when asked)

List:

- screens
- tokens used
- components used
- states covered (default / hover / active / disabled / loading / empty / error)
- mock data shape
- AI behavior and prompts
- AI calls: one row per label with tier, `maxTokens`, and typical tokens from `AI.usageReport()`
- open questions

## Do not

- Add dependencies, npm, build tools, or anything that needs a server.
- Change the folder structure without asking.
- Commit API keys. `.gitignore` covers `.env` and `*.key`, but keys should never be in files at all.
