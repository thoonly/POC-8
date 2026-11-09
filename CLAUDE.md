# CLAUDE.md — CollabIQ Cognitive Workplace (Next.js)

This project was converted from a vanilla-HTML prototype (`legacy/`, still openable from `file://`) into a Next.js app (App Router, TypeScript). The prototype in `legacy/entry-v4.html` is the **behaviour reference** until the port reaches parity. The old prototype rules ("no frameworks, no npm, no server, `file://`") **no longer apply** to the new app. The design, copy and AI rules below do.

## Run

```
npm install
cp .env.example .env.local     # add keys, or set AI_MOCK=1 to run with no key and no cost
npm run dev                    # http://localhost:3000
npm test                       # vitest (pure logic + the AI service)
npm run typecheck
npm run build
npm run check                  # token + AI-call rules (below)
```

## Structure

```
legacy/                  the old prototype (reference only; delete at parity)
src/app/                 routes; api/ai/* are the only place keys are used
src/lib/ai/              client.ts (browser) + server/ (providers, retry, mock). Pure helpers: json.ts
src/lib/lang/            language detection + guard (the originating prompt is the language anchor)
src/lib/entry|graph|chat pure Entry-node logic and prompts (no React, no DOM)
src/store/               Zustand stores (ui, entry, usage, ...). State is never kept in the DOM
src/components/          React components by area (shell, dialogs, cognitive-field, output, chat, ui)
src/styles/              tokens.css (do not edit), entry.css (carried over from the prototype), app.css
```

Ask before changing this structure. Pure logic goes in `src/lib` with a `*.test.ts` next to it. Components stay thin.

## Rules

1. **Tokens only.** Never write hex, rgb or gradient values outside `src/styles/tokens.css`. Use `var(--c-…)` and `var(--g-…)`. If no token fits, ask. Do not invent colors.
2. **Do not edit `tokens.css`** unless explicitly told to. Token changes are versioned by the design system.
3. **Reuse before creating.** Check `src/components` and the classes in `entry.css` first. Keep the prototype's class names so the look stays identical.
4. **Light and dark must both work.** `data-theme` on `<html>` (key `proto.theme`). Check every screen in both.
5. **Semantic HTML.** `<button>`, `<a>`, `<label>`, `<dialog>`. Focus must be visible. Layout must work down to mobile width.
6. **Show real states.** Every data or AI view needs loading, empty and error states, not only the happy path.
7. **Client vs server.** Components never `fetch` a model API and never see a key. They call `ai` from `src/lib/ai/client.ts`, which posts to `/api/ai/*`. Code under `src/lib/ai/server/` is imported only by route handlers and tests.
8. **No hardcoded model ids** outside `src/lib/ai/server/config.ts`. Pages pass a `tier`.
9. **Fake data only** in mocks and fixtures. Never real customer or employee data.
10. **Port prompts verbatim first.** Tidy only after behaviour matches `legacy/`, so differences are attributable to the architecture.

## Tokens

- Naming: `--c-<identifier>` for colors, `--g-<identifier>` for gradients; identifiers keep the design-system casing (`--c-bTxt-primary`, `--g-aiGen-still`).
- Light values are in `:root`; dark overrides in `[data-theme="dark"]`. `--c-solid-*` are mode-independent: never override for dark.
- `brand*` tokens: text, shape, stroke only, **never as a fill**. `indigo-*`: rare spotlight only.
- AI surfaces use `--c-sevPurple`, `--c-lighPurple` (spelling matches the source) and `--g-aiGen-*`. `aiGen-multiAnim-A…D` only for a cycled animation.
- **Do not use** tokens marked `[TBR]`, `[TBC]`, `[LEGACY]` or `[EXPERIMENTAL]`. If one is required, ask.
- Typography, spacing, radius and motion values are **placeholders** (not from colors.pdf). Usable, not final.

## Naming and copy

- Files in `kebab-case` for CSS and folders; React components in `PascalCase.tsx`; light BEM for classes (`.card`, `.card--done`).
- Status vocabulary: `ok` / `warn` / `err` / `neutral`.
- UI copy: English, sentence case, active voice. Buttons say what happens ("Save changes", not "Submit"). One name per action across a flow. Errors say what went wrong and how to fix it, and do not apologize.

## AI integration

All model calls go: component → `ai.json / ai.chat / ai.search` → `/api/ai/*` → provider. Keys, provider and models are **server environment variables** (`.env.local`, see `.env.example`). `AI_MOCK=1` answers every call with canned data (a value generated from the call's schema, or a fixture registered with `registerMock`).

```ts
const plan = await ai.json<Plan>(messages, { label: "entry:gap-check", tier: "small", schema: PLAN_SCHEMA, signal });
const text = await ai.chat(messages, { label: "entry:answer", tier: "large", signal });
```

### Every call: label and tier

- **`label`**: `"<screen>:<task>"`, e.g. `entry:draft-node`. The usage log groups by label, so one task gets one label. The client rejects a call without one.
- **`tier`**: `small` = classify, detect language, extract fields, rewrite/translate, short labels, search queries, yes/no checks. `large` = multi-step reasoning, planning, long documents, anything the user reads as the main result. Start with `small`; move a call to `large` only after you have seen `small` fail on it, and say why in a comment at the call.
- **`maxTokens`** is a runaway guard (default 8192), not a length budget. A low ceiling cuts answers off and the cut-off text is still billed. Do not lower it to control length; raise it only for a call that truly writes more than ~6,000 tokens (Thai/CJK use ~2.8x the tokens: `tokenBudgetMultiplier`).
- **`reasoning`**: `none | minimal | low | medium | high`. Defaults: `none` for small, `low` for large. Raise it for one call only after seeing it fail with less.

### Controlling length

Control length in the prompt and the schema, never with `maxTokens`: exact counts ("exactly 4 categories, 2–3 topics each"), `maxItems` on arrays, a word limit per field, and only the fields the screen shows.

### Structured output

- Use `ai.json(…, { schema })` whenever code reads the answer. Don't parse model text with regexes in a component. `parseJson` in `lib/ai/json.ts` is the fallback parser.
- Schema rules: object at the root, `additionalProperties: false` on every object, every property in `required`, `enum` for fixed values, at most 3 levels of nesting, ids the page gave the model (never free text that must match exactly). The Claude provider strips `min/max*` keywords itself, so still state limits in the prompt.
- Use `ai.chat` for prose the user reads.

### Calls per action

One user action = one call when possible, three at most. A new call must do work the previous one could not. No background model calls (on typing, on a timer, after every change) without asking. Do deterministic work in code: counting, sorting, dedup, id checks, language detection by script.

### Retries and timeouts (hard limits, implemented in `lib/ai/server/http.ts`)

- **Cut off (`length`)**: the server asks once to continue, then joins the parts. Still cut off → `TRUNCATED` (`e.text` = partial). Show the error state; the fix is a shorter request or less reasoning, not a retry.
- **Timeout**: never retried. The request is aborted and throws `TIMEOUT`; show the error state with a **Try again** button the user presses. Pass an `AbortSignal` so a cancelled screen stops costing.
- **Transient errors** (429, 5xx, 529, network): retried by the server with backoff, at most 3 times.
- So per user action a call runs at most twice for a cut-off answer and never repeats after a timeout. Anything more is a bug.

### Errors (`AiError.code`) → `<Banner>`

`NO_KEY`/`NO_MODEL` → message + open AI settings. `HTTP`/`NETWORK` → message (+ Try again). `TIMEOUT` → message + Try again. `TRUNCATED` → message only. `BAD_JSON` → message + Try again. `ABORTED` → ignore (the user left).

### Prompts

Prompts live next to the logic that uses them (`src/lib/<area>/`), as functions that take data and return strings: a short system message with the rules and a user message with the data. No secrets. Send only what the task needs. Small models follow 5 clear rules better than 30.

### Search

`ai.canSearch()` is false when the server's search is off. A search costs a model call plus search fees: give it its own label, keep the default 5 results.

### Measure before you optimize

Every request returns usage rows to the browser; **AI settings → Usage this session** shows the per-label table, and `__aiUsage()` prints it in the console. If `reasoning` is most of `output`, lower `reasoning` before you touch the prompt.

## Enforced by `npm run check`

- no hex/rgb/hsl outside `tokens.css`
- no `fetch` to a model API, and no hardcoded Claude model ids, outside `src/lib/ai/server/`
- every `ai.json / ai.chat / ai.search` call has `label` and `tier`
- no `maxTokens` under 2000
- an intentional exception: put `// check-ignore: <reason>` on the line above

## Workflow for a new screen or feature

1. Read the request; if it is unclear, ask before guessing.
2. Find the behaviour in `legacy/entry-v4.html` (line ranges are noted in each ported module's header).
3. Port pure logic to `src/lib` with tests first, then the store slice, then the component.
4. Verify in the browser: light and dark, keyboard focus, narrow width, all states, no console errors; for AI features run the flow with a real key once and check the usage table (real labels, no cut-offs, no label called more often than needed). Run `npm test`, `npm run typecheck`, `npm run build`, `npm run check`.
5. Record decisions and open questions in the module header comment or `docs/`.

## Do not

- Put a key in the browser, in a file, or in a commit. `.env*.local` is git-ignored.
- Edit `tokens.css`, or add a dependency, without saying why.
- Keep state in the DOM, or monkey-patch functions: one implementation per behaviour (a registry of strategies if variants are needed).
