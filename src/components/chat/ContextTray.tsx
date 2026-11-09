"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { truncateForCard } from "@/lib/text";
import { useChat } from "@/store/chat";
import { IcoClip, IcoFile, IcoGlobe, IcoPencil } from "../ui/Ico";

export interface ContextTrayHandle { pickFile: () => void }

const MAX_BYTES = 8 * 1024 * 1024;
/** Plain-text formats only. PDF and image extraction needs a model call with file blocks (not ported yet). */
const TEXT_TYPES = ".txt,.md,.csv,.json,.html";
const MAX_CHARS = 12000;

const KIND_ICON = { research: <IcoGlobe />, file: <IcoFile />, text: <IcoPencil /> } as const;

/** The context library: chips, the "Add context" form, a viewer, and file upload. */
export const ContextTray = forwardRef<ContextTrayHandle, { busy: boolean }>(function ContextTray({ busy }, ref) {
  const context = useChat((s) => s.context);
  const { addContext, removeContext, contextTurn, note } = useChat.getState();
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [viewId, setViewId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ pickFile: () => fileRef.current?.click() }));

  const add = () => {
    const body = text.trim();
    if (!body || busy) return;
    const c = addContext(title.trim() || truncateForCard(body.split("\n")[0], 34), body);
    setText(""); setTitle(""); setFormOpen(false);
    void contextTurn([c]);
  };

  const onFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    setFormOpen(false);
    const added = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) { note(`${f.name} is larger than 8 MB — skipped.`); continue; }
      if (!/\.(txt|md|csv|json|html?)$/i.test(f.name)) { note(`${f.name} can’t be read yet. Only text files work for now (${TEXT_TYPES}); paste the text with “Add context” instead.`); continue; }
      try {
        const body = truncateForCard(await f.text(), MAX_CHARS);
        if (!body.trim()) throw new Error("No readable content");
        added.push(addContext(f.name, body, "file"));
      } catch (e) {
        note(`Couldn’t read ${f.name} — ${e instanceof Error ? e.message : "unsupported file"}.`);
      }
    }
    if (added.length) void contextTurn(added);
  };

  const viewing = context.find((c) => c.id === viewId);

  return (
    <>
      <div className="chat-head">
        <div className="chat-context-tray">
          <span className="chat-context-label">Context</span>
          <div className="chat-context-chips">
            {!context.length && <span className="chat-context-empty">none yet</span>}
            {context.map((c) => (
              <span key={c.id} className={`ctx-chip ${c.kind === "research" ? "research" : ""} ${c.loading ? "loading" : ""}`} title={c.title}>
                <button type="button" className="ctx-chip-title ctx-chip__btn" aria-label={`View ${c.title}`} onClick={() => setViewId(viewId === c.id ? null : c.id)}>
                  <span>{KIND_ICON[c.kind]}</span><span>{c.loading ? `Reading ${c.title}…` : c.title}</span>
                </button>
                <button type="button" className="ctx-chip-x" aria-label={`Remove ${c.title}`} onClick={() => { removeContext(c.id); if (viewId === c.id) setViewId(null); }}>×</button>
              </span>
            ))}
          </div>
          <button type="button" className="chat-mini-btn" aria-expanded={formOpen} onClick={() => setFormOpen((o) => !o)}>+ Add context</button>
        </div>
      </div>

      {formOpen && (
        <div className="chat-panel chat-ctx-form">
          <label className="home-sr" htmlFor="chat-ctx-title">Label (optional)</label>
          <input type="text" id="chat-ctx-title" placeholder="Label (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="home-sr" htmlFor="chat-ctx-text">Context</label>
          <textarea id="chat-ctx-text" autoFocus placeholder="Paste notes, a brief, meeting minutes, requirements…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="chat-ctx-row">
            <button type="button" className="chat-mini-btn" onClick={() => fileRef.current?.click()}><IcoClip />Upload file…</button>
            <span className="spacer" />
            <button type="button" className="chat-mini-btn" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="chg-btn primary" disabled={!text.trim() || busy} onClick={add}>Add as context</button>
          </div>
        </div>
      )}

      {viewing && !viewing.loading && (
        <div className="chat-panel">
          <div className="chg-row-top"><strong>{viewing.title}</strong><button type="button" className="chat-mini-btn" onClick={() => setViewId(null)}>Close</button></div>
          <div className="chat-ctx-view">{viewing.text}</div>
          <div className="chat-ctx-row">
            <button type="button" className="chat-mini-btn" disabled={busy} onClick={() => { setViewId(null); void contextTurn([viewing]); }}>Use this context to update the exploration</button>
          </div>
        </div>
      )}

      <input
        ref={fileRef} type="file" multiple className="hidden" accept={TEXT_TYPES} aria-label="Attach a text file as context"
        onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; void onFiles(files); }}
      />
    </>
  );
});
