# Prototype template

Clickable HTML prototypes for design review before handoff to dev. Vanilla HTML/CSS/JS, no build step, **no server needed**.

## Open

Double-click `index.html`. Works from `file://` in Chrome, Edge, and Firefox.

## Structure

```
├── CLAUDE.md        team rules (Claude Code reads this automatically)
├── README.md        this file: how to open, mock data shapes, AI setup
├── tokens.css       colors, gradients, typography, spacing — single source of truth
├── components/      button, card, form, table, modal (.css) + ui.js + ai.js
└── index.html       starter screen
```

## AI (OpenRouter, LM Studio or a local server)

Click **AI settings** and choose **Connect via**:

- **OpenRouter** (cloud): paste your OpenRouter API key and pick a model. Default: `anthropic/claude-sonnet-5.5`.
- **Claude API** (cloud, Anthropic): paste your Claude API key (`sk-ant-…`). That's all; the URL, `anthropic-version: 2026-10-21` and the browser-access header are preset.
  - Defaults: Model `claude-opus-5-5`, Small model `claude-haiku-5-5`. `claude-sonnet-5-5` is a cheaper Model.
  - **Test connection** sends one 1-token request to the small model, so it costs a tiny fraction of a cent.
  - The usage log shows a cost estimate from Anthropic's list prices, since the API returns token counts but not a price.
  - On Opus / Sonnet 5.5, a request a safety classifier declines is rerun on a fallback model (`fallbacks: "default"`).
  - **Web search → Claude web search** runs at most 2 searches per lookup.
- **LM Studio**: in LM Studio open **Developer**, load a model, start the server, and turn on **Enable CORS**. Default URL `http://localhost:1234/v1`.
- **Other local server**: any OpenAI-compatible `/v1` API. Default URL `http://localhost:11434/v1` (Ollama; start it with `OLLAMA_ORIGINS=*` so a `file://` page may call it).

**Two models.** **Model** (default `anthropic/claude-sonnet-5.5`) runs calls with `tier: "large"`: main results and multi-step reasoning. **Small model** (default `anthropic/claude-haiku-5.5`) runs calls with `tier: "small"`: classify, extract, rewrite, language checks. On a local server, an empty Small model means the main model runs both.

**Calling the model from a screen.** Every call passes `label` and `tier` (rules in `CLAUDE.md`):

```js
const data = await AI.json(messages, { label: "trip:plan", tier: "large", schema: PLAN_SCHEMA }); // parsed object
const text = await AI.chat(messages, { label: "trip:summary", tier: "small", onToken });          // text, streamed
```

`maxTokens` (default 8192) is a runaway guard, sent as `max_tokens`. You pay only for what the model writes, so a lower ceiling doesn't save money; it cuts answers off. Control length in the prompt and schema instead. `reasoning` (`none` | `minimal` | `low` | `medium` | `high`) sets how much the model thinks: `none` for `small`, `low` for `large`. It's sent to OpenRouter only, and dropped automatically for a model that can't turn thinking off.

A cut-off answer is continued once: the model goes on from where it stopped and the parts are joined. If it is still cut off, the call throws `TRUNCATED`. JSON that won't parse throws `BAD_JSON`. Both errors carry `e.text`. `AI.json` asks for the schema via `response_format`; if a provider or model rejects that, `ai.js` remembers it for the rest of the page session and puts the schema in the prompt instead.

**Usage.** Every request is logged to the console as `[AI] label · tier · model · in … · out …/maxTokens · $cost · ms · finish reason`. **AI settings → Usage this session** shows totals, kept for this browser tab. `AI.usageReport()` prints a table per label, biggest first. Cost appears only for OpenRouter. In `entry-v4.html` and `entry-v5.html`, calls without their own label show as `auto:<function name>`.

For local servers the API key is optional and is sent only to that server; leave the model empty to use the first one the server lists. **Test connection** lists the server's models. Each provider keeps its own URL, key and model, all in this browser's localStorage. Prototype use only; never commit a key.

OpenRouter's web plugin only works with OpenRouter as the provider, and Claude web search only with the Claude API. With a local server, set **Web search** to Tavily (the local model writes the queries and reads the results) or Off. `AI.canSearch()` is false when search is off; pages then fall back to model knowledge and say so.

**Web search.** **Provider:** in AI settings choose "OpenRouter web plugin" or "Tavily". Tavily needs your own Tavily API key (entered in AI settings, stored only in this browser's localStorage); the model writes 1-3 short queries, Tavily runs each at basic depth (1 credit each), and the results go through the same two-step flow below. The model itself still runs on OpenRouter. `AI.search(messages, { maxResults })` runs a live web search through OpenRouter's web plugin and returns `{ text, sources: [{ url, title, content }] }`. The sources are the pages OpenRouter actually returned (url_citation annotations), never URLs the model wrote. OpenRouter bills web results on top of the model. Locally every search runs in two steps: (1) `AI.search` does the live search and writes notes citing the pages it used; (2) `AI.chat` writes the requested answer from those notes and may only cite pages from that numbered list — so facts come from the web, not the model's memory. In `entry-v4.html` every call that asks for `web_search` (Entry/Intent chat research, decision help, Research nodes) uses it when running locally; a cited URL is shown only if the search really returned it. Every node that can search (Entry, Intent, Research nodes) has a **Sources** panel in its Cognitive Field listing every page its searches used, grouped by where they came from (Explore ideas, Chat research, Help me decide, Compare, Findings, Chat). The published claude.ai view has no web search, so there the same calls fall back to model knowledge and say so.

**Decisions can pick several.** A decide node gets `pick: { min, max, fromDod }` — a SUGGESTION, never a limit: 1–1 means a single choice (picking another replaces it); otherwise the user picks any number (at least one). Only when the Definition of done states the number (`fromDod`) does a note show when the picks fall outside it; it never blocks, and the done check flags it. Picks live in `choices` (`choice` = first pick, for older code). Steps whose content came from earlier nodes (criteria, options) are hidden, not just skipped. A multi-pick result shows each pick in its own section.

**Kinds first, then items (gather).** When the things to collect fall into kinds (e.g. museums, shopping, parks), the node opens on "What interests you": the user keeps kinds, then "Pick" searches only within kept kinds (about 3 per kind, "Find more <kind>" per section). The graph shows one branch per kind with its items; the result and hand-off are ordered by kind. Data: `gather.groups: [{ id, label, detail, kept }]`, `items[].group`.

**Context carried into execution.** Every Research prompt (via `exCtx`) gets KNOWN FACTS as constraints — the answer ledger, What the Entry node understood, Entry context, and the Intent audience — plus the items the user did NOT keep in earlier nodes (never brought back). Earlier nodes are found through the whole chain (`exUpstream`), not just the step before. A decide node fed by a define node (criteria) and a gather node (kept candidates) starts at Compare with exactly those; the step says where they came from. Only lists that are about what THIS node chooses are used: the start prompt lists the earlier criteria lists and kept lists, and the AI answers `criteria_from` / `options_from` (fallback: same-lane criteria; a kept list whose noun is in the node title). Other lists stay background context (e.g. a hotel near the chosen attractions).

**Decision result.** Shows the decision, then "What's in" the chosen option (for a set, every member — options that are sets name their members), then how it scored on each criterion (value noted + note), the comparison table, and a collapsed "Where the scores come from" section.

**Research results show Evidence, not a source list.** Each claim behind the decision (option · criterion · value, or question · finding) shows what backs it: a web page (title, site, retrieval time), you, an earlier node, or "⚠ Not verified" with where to check. Research options are idea-first: the model picks what to compare, then one search describes exactly those options. Questions only the user can answer (`ask_user`) go to the node chat. The Sources panel says how many found pages are "used as evidence".

**Framework first.** Every new Research node picks a framework automatically (shown as a collapsible "Framework" bar on every step, with "Use this" to switch — switching restarts the node): the model picks the most fitting established framework for the node's job (name, origin only when certain, idea, why it fits, 3-6 parts, 2 alternatives the user can switch to) and, when search is on, looks for a reference page (otherwise it is labelled general knowledge / unverified; "established: false" = a structured approach, not a published framework). Every later prompt in the node gets the framework; criteria, items and collected candidates carry `dim` (the part they cover) and each step shows coverage ("2 of 3 parts covered — still missing …"). Data: `fw: { name, origin, idea, why, established, dims: [{ n, label, question }], alts: [{ name, idea }], web, noSource }`.

**Nothing in the request gets dropped.** (1) `SPLIT_RULE`: when a request names several places and the time split is unknown, the Entry and Intent question prompts ask how the days are split. (2) Coverage check (`ipCoverageCheck`): after Intent drafts Scope & deliverables and after Planning drafts the plan, the original request is compared with it; anything named but not covered shows "Your request mentions X, but nothing in this … covers it — add it?" with Add it (sent through that node's chat) / Leave it out (remembered; in Intent it is added to Out of scope). Things another workstream covers are shown as such, not flagged. State: `IP.coverage`, `IP.coverIgnored`.

**One decision node by default.** Planning gives every step an `approach` (define / gather / decide). A choice is ONE decide step (its own five steps: what matters → options → compare → decide → result); a separate "define" (criteria) or "gather" (long list) step is split off only when the criteria feed several later steps, collecting the candidates is real research of its own (e.g. 10+ sourced items), or someone must approve in between — and the step's description says which. A later node fed by it (same lane, or a lane that depends on it) receives the agreed criteria: as kept criteria in a decide node, or as the rules every collected item is checked against in a gather node.

**Collect mode (replaces questions/findings for new nodes).** A Research node whose job is to gather things from public information (candidates, examples, providers, facts) runs in "gather" mode: its Definition of done sets the target count, the rules every item must pass and any extra fields. The web search returns items, each with the page it was found on (no page = dropped) and a per-rule check (yes / no / not stated, with what the page says). The user keeps items until the target is met; "Find more" searches again. Data: `gather: { noun, nouns, min, rules: [{ id, text }], fields, items: [{ id, label, detail, web, srcText, fields, checks: { ruleId: { ok, note } }, kept }] }`.

**Define mode + Definition of done first.** A Research node whose job is to write something down (criteria, requirements, rules) runs in "define" mode: its Definition of done sets how many items and which fields each needs (e.g. "How to measure it"); the AI drafts, the user keeps and edits. Every Research result opens with who it is for, then the Definition of done (met / not met, with "Fix this" that goes back to the right step with the gap shown), then the deliverable. Fact questions are searched one per question.

**Fact vs your call (Research find mode).** Each question is a "fact" (searched; a finding needs a page the search returned, or the user's own inputs) or "your call" (a definition, threshold or judgement: the AI drafts suggested answers, labelled as suggestions, and the user decides). The user can switch a question either way. A fact question with nothing sourced shows why and offers ways forward instead of failing. **Who "we" are:** Entry and Intent question prompts ask it once (`WHO_RULE`) when a request talks about "our" product and it is unknown; every answer (the answer ledger) now reaches Research nodes and their searches.

**Sources by node.** Entry (Explore, all levels) is idea-first: the model picks the ideas on its own (search never decides what gets suggested), then one extra web search looks for a page backing each idea as it is. A found page is attached as its source; ideas without one stay, labelled "Model idea — no web source". Research nodes are strict: when a live search runs, facets, named examples, compare evidence and findings must cite a returned page (`source_url`) or they are dropped, and the UI says how many were left out. Without search (published view) items are kept but labelled "Model idea — no web source".

## Mock data

Mock data lives inside each screen's HTML, in one `const MOCK = { ... }` block at the bottom of the page. Use fake data only. When several screens show the same entities, copy these shapes so field names stay identical.

```js
user:    { id, name, email, role, status }          // status: active | invited | suspended
order:   { id, userId, item, total, currency, status } // status: paid | pending | failed

// entry-v4.html — Create workstream handoff (Entry → Intent clarification)
handoff: { node_type: 'trigger', node_name, creator, purpose, expected_output, definition_of_done,
           planned_workstreams: [string],
           in_scope: [{ item, category, whole_category, why: [string] }],   // picked via "Add to scope" in Entry
           input: { originating_entry_node_id, originating_signal, selected_action, clarifying_questions, trigger,
                    context: { entry_node_topic, entry_node_answer, cognitive_field, scratch_pad_notes } } }
intent:  { name, purpose, audience, scopeIn: [{ text, fromEntry }], scopeOut: [string],
           outputs: [{ text, criteria: [string], fromTrigger }], summary, confirmed }
           // handoff.expected_output is context only: Phase 2 splits it into separate deliverables (fromTrigger: true)
lane:    { title, dependsOn: [laneIndex], tier, steps: [step] }
step:    { nodeType, title, description,                 // nodeType: research | workshop | simulation_prep | simulation
           nodeInfo: { sourceIntent, purpose, dod: [string], expectedOutput, typeSpecific: [string], approach: "define" | "gather" | "decide" } }

// entry-v4.html — Execution node work (one per step, keyed "laneIndex.stepIndex"), after Planning is confirmed
// status is derived: done | progress (started) | ready (inputs done) | pending
nodeWork: { started, done, doneAt, dod: [{ ok, note }], output,       // output = what the node hands downstream
            w: research        → { mode: 'decide' | 'find' | 'define', step, fixFor,
                                   def: { noun, nouns, min, fields: [{ key, label, hint }], items: [{ id, label, detail, why, fields: { key: value }, kept }] },   // define: from the node's Definition of done          // guided steps, see RS_STEPS
                                   criteria: [{ id, label, detail, why, weight: 'must' | 'nice', kept, fromDod }],   // fromDod: required by a done-when item
                                   options:  [{ id, label, detail, why, kept, facets: [{ label, detail, web, examples: [{ label, detail, web }] }] }],  // facets = "what's there"; examples = graph level 4
                                   scores:   { optionId: { criterionId: { value, score: 1-5, note, evidence: [{ label, detail, web }], source, web, checkAt, ask, asked, ai } } }, // value = what was noted
                                   choice: optionId, reason,
                                   questions: [{ id, q, detail, kind: "fact" | "yours", kept, note, noWeb, findings: [{ id, label, detail, check, source: "web" | "input" | "estimate" | "suggestion", web, kept }] }] }
               workshop        → { participants, agenda, decisions: [{ q, options: [string], choice, why }] }
               simulation_prep → { scenario, params: [{ name, value, unit, source }], assumptions: [string] }
               simulation      → { questions: [string], overrides: { paramIndex: value },
                                   run: { at, params, scenarios: [{ name, results: [{ metric, value }] }], metrics, answers: [{ q, a }], summary } } }
workstreamResult: { summary, issues: [string],
                    items: [{ deliverable, content, crit: [{ c, ok, evidence }] }] }   // + issues (criteria no node covers), checks (confirm before acting)   // one item per Intent deliverable
```

```js
// entry-v5.html — Result first. The prompt produces the finished result right away; the Cognitive Field is
// the content pool behind it. Same graph shape as v4 (semanticAnalysis.categories → topics → subtopics → examples),
// with these meanings at every level from topic down:
graphItem: { label, detail, why: [string],
             origin: 'grounded' | 'explore',          // grounded = stated by the user; explore = AI idea / info
             role: 'scope' | 'info',                  // info = background information (grey)
             interest: 'kept' | 'pending' | undefined, // kept = IN the output; pending = added, waiting for Update output
             _pendingRemove, _userRemoved }           // removal waiting for Update output; removed by the user (AI must leave it out)
result:    { title, fmt: format, fmtOptions: [format],   // fmt = current; fmtOptions = the Format bar (chosen + suggested for this request + any asked in Chat)
             mdFmt, markdown, assumptions: [string], instructions: [string], unanswered: [string],   // instructions = revisions from Chat; unanswered = skipped questions
             state: 'idle' | 'asking' | 'loading' | 'ready' | 'empty' | 'error', error, used, total }
format:    { kind: 'presentation' | 'text', label, shape }   // decided from what the user asked, e.g. { kind: 'text', label: 'Timetable', shape: 'One table per day: time, activity, place' }
```

Add new entities here as you introduce them, so every screen uses the same names.

## Constraints

- No `fetch` for local files and no `import` / `type="module"`: both break on `file://`. Load everything with plain `<script src>` and `<link>`.
- No frameworks, npm, CDN scripts, or remote fonts and images.
- Calls to OpenRouter work from `file://`; they need internet access.
- Calls to LM Studio or a local server work from `file://` only when the server allows CORS (see AI above).
