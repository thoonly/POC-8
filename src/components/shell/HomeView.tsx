"use client";

import { useEffect, useRef, useState } from "react";
import { useUi } from "@/store/ui";
import { IcoArrowLeft, IcoArrowRight } from "../ui/Ico";

const EXAMPLES: { text: string; label: string }[] = [
  { text: "Plan a two-day offsite for our 20-person design team in Bangkok", label: "Plan a two-day offsite for our 20-person design team in Bangkok" },
  {
    text: 'I received an email from my boss: "Can you book a business trip to Japan including reserve a restaurant for a client dinner and prepare a yearly revenue and profit presentation"',
    label: "My boss asked me to book a Japan trip, reserve a client dinner and prepare a revenue presentation",
  },
  { text: "Analyze our competitors in the SaaS market", label: "Analyze our competitors in the SaaS market" },
];

interface Props {
  /** True once a node exists behind the start page ("Home" brings it back to change the prompt). */
  hasNode: boolean;
  /** The prompt of the current node, used to prefill when the user comes back. */
  currentPrompt: string;
  busy: boolean;
  onSubmit: (prompt: string) => void;
  onOpenAiSettings: () => void;
}

export function HomeView({ hasNode, currentPrompt, busy, onSubmit, onOpenAiSettings }: Props) {
  const [value, setValue] = useState(hasNode ? currentPrompt : "");
  const ta = useRef<HTMLTextAreaElement>(null);
  const backToNode = useUi((s) => s.backToNode);
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const hydrated = useUi((s) => s.hydrated);

  useEffect(() => { ta.current?.focus(); }, []);
  useEffect(() => { // grow with the text, up to 280px
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [value]);

  // Escape returns to the node when there is one behind the start page.
  useEffect(() => {
    if (!hasNode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") backToNode(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasNode, backToNode]);

  const canSubmit = !!value.trim() && !busy;
  const submit = () => { if (canSubmit) onSubmit(value.trim()); };

  return (
    <section className="home-view home-dark" id="prompt-modal-overlay" aria-labelledby="home-title">
      <header className="home-top">
        <div className="masthead-brand"><span className="masthead-logo">◆</span> CollabIQ</div>
        <div className="home-top-tools">
          {hasNode && (
            <button type="button" className="masthead-prompt-btn" onClick={backToNode}><IcoArrowLeft />Back to node</button>
          )}
          <button type="button" className="masthead-prompt-btn" onClick={toggleTheme} suppressHydrationWarning>
            {hydrated && theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button type="button" className="masthead-prompt-btn" onClick={onOpenAiSettings}>AI settings</button>
        </div>
      </header>
      <main className="home-main">
        <p className="home-eyebrow">{hasNode ? "Change your prompt" : "New entry node"}</p>
        <h1 className="home-title" id="home-title">What do you want to work on?</h1>
        <p className="home-sub">
          Describe a goal, a task, or paste a request you received. I’ll ask what’s missing, then map it into your Cognitive Field.
        </p>
        <div className="home-composer">
          <label htmlFor="trigger-input" className="home-sr">Your prompt</label>
          <textarea
            id="trigger-input"
            ref={ta}
            className="home-input"
            rows={3}
            value={value}
            placeholder="e.g. Plan a two-day offsite for our design team in Bangkok"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            }}
          />
          <div className="home-composer-foot">
            <span className="home-hint">Enter to start · Shift+Enter for a new line</span>
            <button className="btn" id="trigger-regen" type="button" disabled={!canSubmit} onClick={submit}>
              {busy ? "Drafting…" : <>Create entry node<IcoArrowRight /></>}
            </button>
          </div>
        </div>
        {hasNode && (
          <p className="home-replace-note">A new prompt starts a new node. It replaces the current Cognitive Field, chat and Output.</p>
        )}
        <div className="home-examples">
          <p className="home-examples-h">Try an example</p>
          <div className="home-example-list">
            {EXAMPLES.map((ex) => (
              <button key={ex.text} type="button" className="home-example" onClick={() => { setValue(ex.text); ta.current?.focus(); }}>
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </main>
    </section>
  );
}
