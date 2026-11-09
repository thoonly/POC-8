"use client";

import { useState } from "react";
import { truncateForCard } from "@/lib/text";
import type { ChoiceGroup } from "@/lib/chat/types";
import { useChat, type DecisionCardData } from "@/store/chat";
import { IcoCompass } from "../ui/Ico";
import { ChatSources } from "./ChatSources";

const FIT_LABEL = { best: "Best fit", good: "Good fit", weak: "Less suited", unknown: "Depends on you" } as const;

/** "Help me decide": compared options, a recommendation, and optional preference questions. */
export function DecisionCard({ msgId, card, disabled }: { msgId: string; card: DecisionCardData; disabled: boolean }) {
  const { chooseDecision, runDecision } = useChat.getState();
  const { request: d, data: dec, sources, chosen } = card;
  const rec = dec.recommendation;
  const locked = !!chosen;

  const [prefs, setPrefs] = useState<ChoiceGroup[]>(() => dec.prefs.map((g) => ({ ...g, options: [...g.options] })));
  const [sel, setSel] = useState<string[][]>(() => dec.prefs.map(() => []));
  const [draft, setDraft] = useState<string[]>(() => dec.prefs.map(() => ""));
  const setAt = <T,>(arr: T[], i: number, v: T) => arr.map((x, k) => (k === i ? v : x));

  const pick = (gi: number, o: string) => {
    const has = sel[gi].includes(o);
    setSel((s) => setAt(s, gi, prefs[gi].multi ? (has ? s[gi].filter((x) => x !== o) : [...s[gi], o]) : has ? [] : [o]));
  };
  const addCustom = (gi: number) => {
    const v = draft[gi].trim();
    if (!v) return;
    if (!prefs[gi].options.includes(v)) setPrefs((p) => setAt(p, gi, { ...p[gi], options: [...p[gi].options, v] }));
    setSel((s) => setAt(s, gi, prefs[gi].multi ? (s[gi].includes(v) ? s[gi] : [...s[gi], v]) : [v]));
    setDraft((x) => setAt(x, gi, ""));
  };
  const preferences = prefs.map((g, gi) => (sel[gi].length ? { q: g.prompt, a: sel[gi].join(", ") } : null)).filter((p): p is { q: string; a: string } => !!p);

  return (
    <div className="decision-card">
      <div className="dec-head"><IcoCompass /> {d.question}</div>
      {rec ? (
        <div className="dec-rec">
          <div className="dec-rec-top"><span className="dec-rec-label">Recommended</span><span className={`dec-conf dec-conf-${rec.confidence}`}>{rec.confidence} confidence</span></div>
          <div className="dec-rec-option">{rec.option}</div>
          {rec.why && <div className="dec-rec-why">{rec.why}</div>}
          {!locked && <button type="button" className="chg-btn primary" disabled={disabled} onClick={() => chooseDecision(msgId, rec.option)}>Use “{truncateForCard(rec.option, 40)}”</button>}
        </div>
      ) : (
        <div className="dec-norec">I don’t know enough yet to pick one — answer below and I’ll recommend.</div>
      )}

      <div className="dec-options">
        {dec.options.map((o) => (
          <div key={o.option} className={`dec-opt fit-${o.fit} ${chosen === o.option ? "chosen" : ""}`}>
            <div className="dec-opt-top">
              <div className="dec-opt-name">{o.option}</div>
              <span className={`dec-fit dec-fit-${o.fit}`}>{FIT_LABEL[o.fit]}</span>
            </div>
            {o.summary && <div className="dec-opt-summary">{o.summary}</div>}
            <details open={rec?.option === o.option}>
              <summary>Pros, cons & who it suits</summary>
              {o.pros.length > 0 && <ul className="dec-pros">{o.pros.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              {o.cons.length > 0 && <ul className="dec-cons">{o.cons.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              {o.best_if && <div className="dec-bestif"><strong>Best if:</strong> {o.best_if}</div>}
            </details>
            {locked
              ? chosen === o.option && <div className="chg-state applied">✓ Chosen — updating below</div>
              : <button type="button" className="chg-btn" disabled={disabled} onClick={() => chooseDecision(msgId, o.option)}>Choose this</button>}
          </div>
        ))}
      </div>

      {prefs.length > 0 && !locked && (
        <div className="dec-prefs">
          <div className="dec-prefs-title">{rec ? "Want it more tailored? Tell me:" : "Tell me a bit about what you need:"}</div>
          {prefs.map((g, gi) => (
            <div key={gi} className="choice-group">
              <div className="choice-prompt">{g.prompt}{g.multi && <span className="choice-multi"> · pick any</span>}</div>
              <div className="choice-chips">
                {g.options.map((o) => (
                  <button key={o} type="button" aria-pressed={sel[gi].includes(o)} className={`choice-chip ${sel[gi].includes(o) ? "selected" : ""}`} onClick={() => pick(gi, o)}>{o}</button>
                ))}
                <span className="choice-add-wrap">
                  <input
                    type="text" className="choice-other" placeholder="Add…" aria-label="Add your own answer" value={draft[gi]}
                    onChange={(e) => setDraft((x) => setAt(x, gi, e.target.value))}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); addCustom(gi); } }}
                  />
                  <button type="button" className="choice-add-btn" onClick={() => addCustom(gi)}>+ Add</button>
                </span>
              </div>
            </div>
          ))}
          <div className="choice-foot">
            <button type="button" className="chg-btn primary" disabled={!preferences.length || disabled} onClick={() => runDecision({ question: d.question, options: d.options, preferences })}>
              {rec ? "Refine recommendation" : "Recommend for me"}
            </button>
          </div>
        </div>
      )}

      <ChatSources sources={sources} title="Researched from" className="msg-sources dec-sources" />
    </div>
  );
}
