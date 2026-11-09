"use client";

import { useEffect, useRef, useState } from "react";
import { IcoClip, IcoSend } from "../ui/Ico";

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onAttach: () => void;
}

/** The Universal Input Bar: grows with the text, Enter sends, Shift+Enter adds a line. */
export function Composer({ busy, onSend, onAttach }: Props) {
  const [value, setValue] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);

  // Fit the height to the text, and again whenever the bar's width changes (panel resize, layout switch).
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    const fit = () => { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let last = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w && w !== last) { last = w; fit(); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);

  const send = () => {
    const t = value.trim();
    if (!t || busy) return;
    setValue("");
    onSend(t);
  };

  return (
    <div className="uib">
      <div className="uib-row">
        <button type="button" className="uib-attach" title="Attach a text file as context" aria-label="Attach a text file as context" onClick={onAttach}><IcoClip /></button>
        <label htmlFor="uib-input" className="home-sr">Message to Chat</label>
        <textarea
          id="uib-input" ref={ta} rows={1} value={value} placeholder="Ask, command, or add context…"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        />
        <button type="button" className="uib-send" title="Send" aria-label="Send" disabled={busy || !value.trim()} onClick={send}><IcoSend /></button>
      </div>
      <div className="uib-hint">Enter to send · Shift+Enter new line · Say “research …” to search the web</div>
    </div>
  );
}
