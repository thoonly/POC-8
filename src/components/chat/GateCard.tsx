"use client";

import type { GateCardData } from "@/lib/entry/gate";
import { gateActions } from "@/store/gate";

interface Props {
  msgId: string;
  card: GateCardData;
  /** Opens the file picker (the context tray owns the file input). */
  onAttach: () => void;
}

/** Options under a clarifying question from the prompt gate. Answered once, then locked. */
export function GateCard({ msgId, card, onAttach }: Props) {
  return (
    <div className="choice-card gate-card">
      {card.options.length > 0 && (
        <div className="gate-options">
          {card.options.map((it, i) => (
            <button
              key={i} type="button" disabled={card.locked}
              className={`gate-option${card.chosen === `o:${i}` ? " chosen" : ""}`}
              onClick={() => gateActions.pick(msgId, i)}
            >
              {card.letters && <span className="gate-letter">{"ABCD"[i]}.</span>}
              <span>
                <span className="gate-label">{it.label}</span>
                {it.detail && <span className="gate-detail">{it.detail}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="choice-foot gate-foot">
        {card.hint && <span className="gate-hint">{card.hint}</span>}
        {card.buttons.map((b) => (
          <button
            key={b.id} type="button" disabled={card.locked}
            className={`chg-btn${b.primary ? " primary" : ""}`}
            onClick={() => { if (b.id === "attach") onAttach(); gateActions.press(msgId, b.id); }}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
