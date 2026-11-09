# Chat to OpenRouter: sequence diagrams

Internal document. Describes how a user message in the `entry-v4.html` chat reaches `https://openrouter.ai/api/v1/chat/completions` and how the answer returns.

- **Date:** 2026-11-03
- **Sources:** `entry-v4.html` (chat UI and AI shim), `components/ai.js` (AI harness)
- **Status:** read from code, not run. Diagram syntax was checked by eye only and has not been rendered. Paste into [mermaid.live](https://mermaid.live) or a Markdown preview to confirm.
- **Tags:** 🟢 confirmed in source, 🟡 inference from source, 🔴 gap or conflict

## Summary

The chat does not call OpenRouter directly. A message goes through three layers before the HTTP request is made:

`runChatTurn` → `callClaudeRaw` → `anthropicMessages` / `__openRouterMessages` (shim) → `AI.chat` (`ai.js`) → `POST /chat/completions`

The page speaks the Anthropic Messages shape. The shim converts it to a plain prompt for `AI.chat`, then wraps the answer back into a Messages-shaped response so existing page code keeps working. This route is used only when `window.claude.use()` is missing and `window.AI` exists (the local `file://` prototype).

## Diagram 1: normal chat turn

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant Chat as Chat UI<br/>(runChatTurn)
    participant Raw as callClaudeRaw
    participant Shim as __openRouterMessages
    participant AI as ai.js<br/>(AI.chat → complete → request)
    participant API as OpenRouter<br/>POST /api/v1/chat/completions

    U->>Chat: Type a message, press Send
    Chat->>Chat: Add user bubble, push to chatHistory, show "Thinking…"
    Chat->>Raw: Router prompt (maxTokens 1800)
    Raw->>Shim: anthropicMessages(body)
    Note over Shim: Local prototype route (no claude.use, AI.chat exists).<br/>Keeps only the prompt text. model is dropped, and max_tokens<br/>is forwarded only when above 8192 (so 1800 is ignored).
    Shim->>AI: AI.chat(messages, label v4:messages, tier large)<br/>no onToken, so no streaming
    AI->>AI: Read provider, key, model from localStorage<br/>reasoning = low (default for large), max_tokens = 8192

    alt No API key
        AI-->>Shim: throw AiError NO_KEY
        Shim-->>U: Open AI settings dialog
        Shim-->>Raw: Fake response, status 401
        Raw-->>Chat: throw Error(message)
    else API key present
        AI->>API: POST (Authorization: Bearer key)<br/>body: model, messages, stream false, max_tokens, reasoning, usage include

        alt Network failure
            AI-xAPI: fetch fails (offline, CORS, DNS)
            AI-->>Shim: throw AiError NETWORK
            Shim-->>Raw: Fake response, status 503 (counted as transient)
            loop Up to 4 retries, backoff 1s to 8s
                Raw->>Shim: anthropicMessages(body) again
            end
            Raw-->>Chat: throw Error("AI service is busy")
        else HTTP error (401, 402, 429, 5xx)
            API-->>AI: non-2xx + error message
            AI-->>Shim: throw AiError HTTP
            Shim-->>Raw: Fake response, status 400 (not retried)
            Raw-->>Chat: throw Error(message)
        else 200 OK
            API-->>AI: JSON: choices[0].message.content, finish_reason, usage
            AI->>AI: Record usage (label, tokens, cost, ms)
            opt finish_reason = length (answer cut off)
                AI->>API: 2nd POST: previous text + "continue where you stopped"
                API-->>AI: Rest of the answer
                AI->>AI: Join the two parts
                Note over AI,Shim: Still cut off after this → AiError TRUNCATED with partial text.<br/>Shim returns 200 with the partial text and stop_reason max_tokens.
            end
            AI-->>Shim: Answer text
            Shim-->>Raw: Fake Messages response, 200 (text block, stop_reason end_turn)
            Raw-->>Chat: data
            Chat->>Chat: chatParseJson, enforceAnchorLanguage, route by kind
            Chat-->>U: Assistant bubble (reply, actions, choices)
        end
    end

    Note over Chat,U: On any thrown error: remove "Thinking…", show a system message with err.message.<br/>Send button is re-enabled in finally.
```

## Diagram 2: chat turn that needs web research (`needs_research`)

This path calls the endpoint **twice**: first a web search that writes notes, then the final answer written from those notes.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant Chat as Chat UI<br/>(runChatTurn)
    participant Raw as callClaudeRaw
    participant Shim as __openRouterMessages
    participant AI as ai.js<br/>(AI.search, AI.chat)
    participant API as OpenRouter<br/>POST /api/v1/chat/completions

    U->>Chat: Ask something that needs fresh facts
    Note over Chat: Router reply has needs_research = true<br/>(the router call itself follows diagram 1)
    Chat->>Chat: Show "Searching the web for ..."
    Chat->>Raw: Research prompt + web_search tool (maxTokens 3000)
    Raw->>Shim: anthropicMessages(body with tools)
    Shim->>AI: AI.search(notes prompt, maxResults 8)<br/>no label or tier passed
    AI->>API: POST /chat/completions<br/>plugins: web, max_results 8
    API-->>AI: Research notes + url_citation annotations
    AI-->>Shim: text + sources (url, title)
    Shim->>AI: AI.chat(task + notes + numbered sources,<br/>label v4:researched-answer, tier large)
    AI->>API: POST /chat/completions (no plugin)
    API-->>AI: Final answer citing only the numbered sources
    AI-->>Shim: Answer text
    Shim-->>Raw: Fake Messages response: web_search_tool_result + text with citations
    Raw-->>Chat: data
    Chat->>Chat: chatExtractSources, chatParseJson
    Chat-->>U: Reply + findings + Sources links, new context item
```

## Code references

| Step | Location |
|---|---|
| Chat turn handler | `entry-v4.html:12497` (`runChatTurn`) |
| Retry and error handling for page calls | `entry-v4.html:11959` (`callClaudeRaw`) |
| Route choice (`claude.use`, AI harness, direct API) | `entry-v4.html:3605` (`anthropicMessages`) |
| Messages-to-`AI.chat` shim | `entry-v4.html:3540` (`__openRouterMessages`) |
| label, tier, maxTokens options | `entry-v4.html:3535` (`__aiOpts`) |
| HTTP request to `/chat/completions` | `components/ai.js:320` (`request`) |
| Web search request with `plugins: web` | `components/ai.js:734` (`searchOpenRouter`) |
| Continuation after a cut-off answer | `components/ai.js:551` (`complete`) |

## Findings

- 🟢 The chat does not stream. The shim passes no `onToken`, so `AI.chat` sends `stream: false` (`ai.js:297`), although `ai.js` supports streaming.
- 🟢 The chat's own `maxTokens` (1800, 3000) never reaches `ai.js`. `__aiOpts` forwards `max_tokens` only above 8192, so the default 8192 applies.
- 🟢 The model id hardcoded in `callClaudeRaw` (`claude-sonnet-4-6`) is dropped by the shim. The model comes from AI settings.
- 🟢 The shim maps errors to fake HTTP statuses: `NO_KEY` → 401, `NETWORK` → 503, everything else → 400 (`entry-v4.html:3601`). `AiError` has no status field (`ai.js:55`).
- 🟡 Consequence: a 429 or 5xx from OpenRouter becomes 400, so `callClaudeRaw` does not retry it (it retries only 429, 5xx and `overloaded_error`). Network failures are retried up to 4 times, while CLAUDE.md says up to 3. Not verified by running.
- 🟡 On `TRUNCATED`, `callClaudeRaw` does not check `stop_reason`, so cut-off JSON goes to `chatParseJson`. It likely fails to parse and shows "Could not read the response". `enforceAnchorLanguage` was not read to confirm.
- 🔴 Conflict with CLAUDE.md: every call through `callClaudeRaw` shares the label `v4:messages` and tier `large`. The usage log cannot separate the router call from other tasks, and a classify task like the router should start at `small`.
- 🔴 Conflict with CLAUDE.md: `AI.search` in the shim passes no label or tier (`entry-v4.html:3561`), so `ai.js` falls back to `callerLabel()`.

## Not covered

- Other `runChatTurn` branches: `explore_more`, `presentation`, `decision_help`. Each makes further calls.
- Other providers (Claude API, LM Studio) and the `claude.use()` and `__directMessages` routes.
- Diagram 2 assumes the search provider is OpenRouter. With Tavily or Claude web search, `AI.search` takes another path. With search set to `off`, `AI.search` returns empty and the shim continues with "(no notes)" (`ai.js:620`, `entry-v4.html:3572`). Read from code, not run.

## Open questions

1. Should the retry mapping in the shim be fixed so 429 and 5xx are retried, and the retry count aligned with CLAUDE.md (3, not 4)?
2. Should the router call and the research call get their own labels, and should the router move to tier `small`?
3. Should the shim surface `stop_reason: max_tokens` to `callClaudeRaw`, so a cut-off answer shows a clear error instead of a parse failure?
