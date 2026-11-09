"use client";

import { useRef, useState, type ReactNode } from "react";
import type { ChoiceGroup } from "@/lib/chat/types";
import { IcoCompass, IcoPencil, IcoPlus } from "../ui/Ico";

interface Props {
  groups: ChoiceGroup[];
  sent: boolean;
  disabled: boolean;
  onSend: (groups: ChoiceGroup[], picked: string[][]) => void;
  onDismiss: () => void;
  /** Shows the "Help me decide" link on each question. Omit it for a card that only collects answers. */
  onDecide?: (group: ChoiceGroup) => void;
  /** Wording that differs by use. The defaults are the Chat suggestion card's. */
  copy?: {
    head: (groupCount: number) => ReactNode;
    dismiss: string;
    send: (answered: number, total: number) => string;
    sent: string;
  };
}

const CHAT_COPY: NonNullable<Props["copy"]> = {
  head: (n) => (n > 1 ? <><IcoPencil /> Answer what you can — your answers update the exploration</> : <><IcoPlus /> Use this in your exploration?</>),
  dismiss: "Not now",
  send: (answered, total) => (total > 1 ? `Update (${answered}/${total})` : "Update"),
  sent: "✓ Sent — see the changes below",
};

/** The size questions asked before a workstream is suggested (the gap analysis). */
export const GAP_COPY: NonNullable<Props["copy"]> = {
  head: () => "A few quick questions first",
  dismiss: "Skip — use your best judgment",
  send: (answered, total) => `Continue (${answered}/${total})`,
  sent: "✓ Got it",
};

/** One-tap answers that update the exploration. Chips can be added, picked and removed before sending. */
export function ChoiceCard({ groups: initial, sent, disabled, onSend, onDismiss, onDecide, copy = CHAT_COPY }: Props) {
  const [groups, setGroups] = useState<ChoiceGroup[]>(() => initial.map((g) => ({ ...g, options: [...g.options] })));
  const [sel, setSel] = useState<string[][]>(() => initial.map(() => []));
  const [own, setOwn] = useState<Set<string>[]>(() => initial.map(() => new Set()));
  const [editing, setEditing] = useState<boolean[]>(() => initial.map(() => false));
  const [drafts, setDrafts] = useState<string[]>(() => initial.map(() => ""));
  const composing = useRef(false);

  const setAt = <T,>(arr: T[], i: number, v: T) => arr.map((x, k) => (k === i ? v : x));
  const answered = groups.filter((_, i) => sel[i].length || drafts[i].trim()).length;

  const pick = (gi: number, o: string) => {
    const has = sel[gi].includes(o);
    setSel((s) => setAt(s, gi, groups[gi].multi ? (has ? s[gi].filter((x) => x !== o) : [...s[gi], o]) : has ? [] : [o]));
  };

  /** Turns typed text into a real chip, selects it, and returns the new state for the caller to merge. */
  const commit = (gi: number, v: string, g = groups, s = sel, ow = own) => {
    const value = v.trim();
    if (!value) return { g, s, ow };
    const has = g[gi].options.includes(value);
    const ng = has ? g : setAt(g, gi, { ...g[gi], options: [...g[gi].options, value] });
    const nown = has ? ow : setAt(ow, gi, new Set(ow[gi]).add(value));
    const ns = setAt(s, gi, g[gi].multi ? (s[gi].includes(value) ? s[gi] : [...s[gi], value]) : [value]);
    return { g: ng, s: ns, ow: nown };
  };
  const apply = (r: ReturnType<typeof commit>) => { setGroups(r.g); setSel(r.s); setOwn(r.ow); };

  const remove = (gi: number, o: string) => {
    setGroups((g) => setAt(g, gi, { ...g[gi], options: g[gi].options.filter((x) => x !== o) }));
    setOwn((ow) => setAt(ow, gi, new Set([...ow[gi]].filter((x) => x !== o))));
    setSel((s) => setAt(s, gi, s[gi].filter((x) => x !== o)));
  };

  const send = () => {
    let r = { g: groups, s: sel, ow: own };
    groups.forEach((_, gi) => { if (drafts[gi].trim()) r = commit(gi, drafts[gi], r.g, r.s, r.ow); });
    apply(r);
    setDrafts(initial.map(() => ""));
    setEditing(initial.map(() => false));
    onSend(r.g, r.s);
  };

  return (
    <div className="choice-card">
      <div className="choice-head">{copy.head(groups.length)}</div>
      {groups.map((g, gi) => (
        <div key={gi} className="choice-group">
          <div className="choice-prompt">
            {g.prompt}
            {g.multi && <span className="choice-multi"> · pick any</span>}
            {!sent && onDecide && (
              <> <button type="button" className="decide-link" disabled={disabled} onClick={() => onDecide(g)}><IcoCompass /> Help me decide</button></>
            )}
          </div>
          <div className="choice-chips">
            {g.options.map((o) => (
              <button
                key={o} type="button" disabled={sent} aria-pressed={sel[gi].includes(o)}
                className={`choice-chip ${sel[gi].includes(o) ? "selected" : ""}${own[gi].has(o) ? " own" : ""}`}
                onClick={() => pick(gi, o)}
              >
                {o}
                {own[gi].has(o) && !sent && (
                  <span
                    className="chip-x" role="button" aria-label={`Remove ${o}`}
                    onClick={(e) => { e.stopPropagation(); remove(gi, o); }}
                  >×</span>
                )}
              </button>
            ))}
            {!sent && (editing[gi] ? (
              <input
                type="text" className="choice-chip-input" autoFocus aria-label="Add your own answer"
                value={drafts[gi]} size={Math.max(14, drafts[gi].length + 2)} placeholder="Type, then Enter"
                onChange={(e) => setDrafts((d) => setAt(d, gi, e.target.value))}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); setDrafts((d) => setAt(d, gi, "")); setEditing((x) => setAt(x, gi, false)); return; }
                  if (e.key !== "Enter" || composing.current || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  apply(commit(gi, drafts[gi]));
                  setDrafts((d) => setAt(d, gi, "")); // stays open for the next one
                }}
                onBlur={(e) => {
                  if (drafts[gi].trim() && !e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) apply(commit(gi, drafts[gi]));
                  setDrafts((d) => setAt(d, gi, ""));
                  setEditing((x) => setAt(x, gi, false));
                }}
              />
            ) : (
              <button type="button" className="choice-chip choice-add-chip" onClick={() => setEditing((x) => setAt(x, gi, true))}>+ Add</button>
            ))}
          </div>
        </div>
      ))}
      <div className="choice-foot">
        {sent ? (
          <span className="chg-state applied">{copy.sent}</span>
        ) : (
          <>
            <button type="button" className="chg-btn" onClick={onDismiss}>{copy.dismiss}</button>
            <button type="button" className="chg-btn primary" disabled={!answered || disabled} onClick={send}>
              {copy.send(answered, groups.length)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
