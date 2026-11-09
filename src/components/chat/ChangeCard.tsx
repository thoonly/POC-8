"use client";

import type { ChatAction } from "@/lib/chat/types";
import { useChat } from "@/store/chat";
import { IcoWarn } from "../ui/Ico";

interface Props {
  msgId: string;
  /** auto = already applied by the policy (with Undo); confirm = waits for the user. */
  variant: "auto" | "confirm";
  actions: ChatAction[];
}

const STATE_LABEL: Record<string, string> = { applied: "✓ Applied", skipped: "Skipped", undone: "Undone" };

export function ChangeCard({ msgId, variant, actions }: Props) {
  const { applyAction, skipAction, undoAction, applyAll, skipAll } = useChat.getState();
  const pending = actions.filter((a) => a.state === "pending");

  return (
    <div className={`chg-card ${variant}`}>
      <div className="chg-head">
        <span>{variant === "auto" ? "✓ Applied" : "⏸ Needs your confirmation"}</span>
        {variant === "confirm" && pending.length > 1 && (
          <span className="chg-head-actions">
            <button type="button" className="chg-btn" onClick={() => skipAll(msgId)}>Skip all</button>
            <button type="button" className="chg-btn primary" onClick={() => applyAll(msgId)}>Apply all</button>
          </span>
        )}
      </div>
      {actions.map((a) => (
        <div key={a.uid} className={`chg-row ${a.state === "pending" ? "" : "resolved"}`}>
          <div className="chg-row-top">
            <div className="chg-label">{a.label}</div>
            <div className="chg-btns">
              {a.state === "pending" && (
                <>
                  <button type="button" className="chg-btn" onClick={() => skipAction(msgId, a.uid)}>Skip</button>
                  <button type="button" className="chg-btn primary" onClick={() => applyAction(msgId, a.uid)}>Apply</button>
                </>
              )}
              {a.state === "applied" && (
                <>
                  <span className="chg-state applied">{STATE_LABEL.applied}</span>
                  {a.undoable && <button type="button" className="chg-btn" onClick={() => undoAction(msgId, a.uid)}>Undo</button>}
                </>
              )}
              {a.state === "stale" && <span className="chg-state stale"><IcoWarn /> {a.staleMsg || "Could not apply"}</span>}
              {(a.state === "skipped" || a.state === "undone") && <span className={`chg-state ${a.state}`}>{STATE_LABEL[a.state]}</span>}
            </div>
          </div>
          {variant === "confirm" && a.why && <div className="chg-why">Why confirm: {a.why}</div>}
          {a.conflict && <div className="chg-conflict"><IcoWarn /> {a.conflict}</div>}
          {a.beforeSnap && <div className="chg-before">{a.beforeSnap}</div>}
          {a.op !== "remove_item" && a.op !== "regenerate_output" && <div className="chg-value">{a.value}</div>}
          {a.reason && <div className="chg-reason">{a.reason}</div>}
        </div>
      ))}
    </div>
  );
}
