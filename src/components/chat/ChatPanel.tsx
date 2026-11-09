"use client";

import { useEffect, useRef, useState } from "react";
import { pendingCount, useChat, type ChatItem } from "@/store/chat";
import { selectGateHeld, useGateRoute } from "@/store/gateRoute";
import { Banner } from "../dialogs/Banner";
import { IcoCompass, IcoGlobe } from "../ui/Ico";
import { ChangeCard } from "./ChangeCard";
import { ChatMarkdown } from "./ChatMarkdown";
import { hideOpenMarkup } from "@/lib/chat/markdown";
import { ChatSources } from "./ChatSources";
import { gapActions } from "@/store/gate";
import { ChoiceCard, GAP_COPY } from "./ChoiceCard";
import { Composer } from "./Composer";
import { ContextTray, type ContextTrayHandle } from "./ContextTray";
import { DecisionCard } from "./DecisionCard";
import { GateCard } from "./GateCard";

const KIND_LABEL = {
  question: "Answer", command: "Command", context: "Context",
  research: <><IcoGlobe /> Research</>, decision: <><IcoCompass /> Decision help</>,
} as const;

function Assistant({ m, busy, onAttach }: { m: Extract<ChatItem, { type: "assistant" }>; busy: boolean; onAttach: () => void }) {
  const { answerChoices, dismissChoices, runDecision } = useChat.getState();
  return (
    <div className="msg assistant">
      {m.kind && <div className="msg-meta"><span className={`kind-pill kind-${m.kind}`}>{KIND_LABEL[m.kind]}</span></div>}
      <div className="msg-bubble">
        <ChatMarkdown text={m.text} />
        {m.findings && m.findings.length > 0 && <ul className="msg-findings">{m.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>}
        {m.sources && <ChatSources sources={m.sources} />}
      </div>
      {m.note && <div className="msg-note">{m.note}</div>}
      {m.confirm && <ChangeCard msgId={m.id} variant="confirm" actions={m.confirm} />}
      {m.auto && <ChangeCard msgId={m.id} variant="auto" actions={m.auto} />}
      {m.choices && !m.choicesDismissed && (
        <ChoiceCard
          groups={m.choices} sent={!!m.choicesSent} disabled={busy}
          onSend={(g, picked) => answerChoices(m.id, g, picked)}
          onDismiss={() => dismissChoices(m.id)}
          onDecide={(g) => void runDecision({ question: g.prompt, options: g.options.slice() })}
        />
      )}
      {m.decision && <DecisionCard msgId={m.id} card={m.decision} disabled={busy} />}
      {m.gate && <GateCard msgId={m.id} card={m.gate} onAttach={onAttach} />}
      {m.gaps && (
        <ChoiceCard
          groups={m.gaps.groups} sent={m.gaps.resolved} disabled={false} copy={GAP_COPY}
          onSend={(g, picked) => gapActions.send(m.id, g, picked)}
          onDismiss={() => gapActions.skip(m.id)}
        />
      )}
    </div>
  );
}

const POLICY_AUTO = [
  "Adding a category or topic to the Cognitive Field",
  "Adding a Suggested or Available action",
  "Adding a Scratch pad note",
  "Weaving a new detail into the Topic or Answer while keeping the rest of it (if most of the wording survives)",
  "Saving pasted text, files, or research as Context",
];
const POLICY_CONFIRM = [
  "Rewriting the Topic or Answer — changing its meaning, or keeping less than 60% of its wording",
  "Editing or removing a category, topic, or action already on the graph/Output",
  "Regenerating the Output from the current Topic",
  "Any change drawn from web research",
  "Any change the AI flags as conflicting with the current Topic/Answer",
  "More than 4 changes proposed at once",
];

interface Props { onOpenAiSettings: () => void }

/** Chat for the Entry node: the conversation, its context library and the composer. */
export function ChatPanel({ onOpenAiSettings }: Props) {
  const items = useChat((s) => s.items);
  const chatBusy = useChat((s) => s.busy);
  // While the prompt gate is mid-check there is nothing to answer yet: hold the composer (the text stays in it).
  const gateHeld = useGateRoute(selectGateHeld);
  const busy = chatBusy || gateHeld;
  const status = useChat((s) => s.status);
  const draft = useChat((s) => s.draft);
  const send = useChat((s) => s.send);
  const retry = useChat((s) => s.retry);
  const [policyOpen, setPolicyOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const tray = useRef<ContextTrayHandle>(null);
  const pending = pendingCount(items);

  // Anything the assistant adds brings the conversation to the bottom.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, status, draft]);

  const dismiss = (id: string) => useChat.setState((s) => ({ items: s.items.filter((m) => m.id !== id) }));

  const conversation = (
    <div className="chat-wrap" id="chat-wrap">
      <ContextTray ref={tray} busy={busy} />
      <div className="chat-head">
        <button type="button" className="chat-mini-btn" aria-expanded={policyOpen} onClick={() => setPolicyOpen((o) => !o)} title="Which chat changes apply instantly vs. wait for you">ⓘ How changes apply</button>
        {pending > 0 && <span className="chg-state stale" role="status" style={{ marginLeft: "auto" }}>{pending} to review</span>}
      </div>
      {policyOpen && (
        <div className="chat-panel">
          <div className="chat-policy-grid">
            <div className="chat-policy-col auto"><h4>✓ Applied instantly (with Undo)</h4><ul>{POLICY_AUTO.map((t) => <li key={t}>{t}</li>)}</ul></div>
            <div className="chat-policy-col confirm"><h4>⏸ Waits for your confirmation</h4><ul>{POLICY_CONFIRM.map((t) => <li key={t}>{t}</li>)}</ul></div>
          </div>
          <div className="chat-policy-foot"><IcoCompass /> “Help me decide” compares options (with web research when facts matter) and recommends one based on what’s known about this exploration — nothing changes until you choose an option, and your choice follows the rules above.</div>
        </div>
      )}

      <div className="chat-messages" ref={list} role="log" aria-live="polite" aria-label="Chat conversation">
        {!items.length && !status && !draft && (
          <div className="chat-empty">
            <div className="chat-empty-title">Chat with this exploration</div>
            Ask questions, give commands, or add context. Changes land in the Cognitive Field, Answer, or Actions — small additions instantly, anything bigger after you confirm.
          </div>
        )}
        {items.map((m) => {
          if (m.type === "user") return <div key={m.id} className="msg user"><div className="msg-bubble">{m.text}</div></div>;
          if (m.type === "assistant") return <Assistant key={m.id} m={m} busy={busy} onAttach={() => tray.current?.pickFile()} />;
          if (m.error) {
            return (
              <div key={m.id} className="chat-error">
                <Banner error={m.error} onRetry={() => void retry()} onOpenSettings={onOpenAiSettings} onDismiss={() => dismiss(m.id)} />
              </div>
            );
          }
          return <div key={m.id} className="msg system"><div className="msg-bubble">{m.text}</div></div>;
        })}
        {draft && (
          <div className="msg assistant" aria-busy="true">
            <div className="msg-bubble"><ChatMarkdown text={hideOpenMarkup(draft)} /></div>
          </div>
        )}
        {status && !draft && <div className="msg-status"><span className="dot-spin" /><span>{status}</span></div>}
      </div>
    </div>
  );

  return (
    <>
      {conversation}
      <Composer busy={busy} onSend={(t) => void send(t)} onAttach={() => tray.current?.pickFile()} />
    </>
  );
}
