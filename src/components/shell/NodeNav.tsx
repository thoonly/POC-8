"use client";

import { Fragment } from "react";
import { useUi, type NodeKey } from "@/store/ui";
import { IcoArrowRight } from "../ui/Ico";

const STEPS: { key: NodeKey; n: number; label: string; execPart?: boolean }[] = [
  { key: "entry", n: 1, label: "Entry" },
  { key: "intent", n: 2, label: "Intent clarification" },
  { key: "planning", n: 3, label: "Planning" },
  { key: "exec", n: 4, label: "Execution", execPart: true },
  { key: "result", n: 5, label: "Workstream result", execPart: true },
];

/**
 * Entry is the only node built so far (Milestone 1). Later nodes show as disabled steps with a
 * title, never as links that lead nowhere. Execution and Result stay hidden until Planning exists,
 * as in the prototype (.nn-exec-part).
 */
export function NodeNav({ showExec = false }: { showExec?: boolean }) {
  const active = useUi((s) => s.activeNode);
  const setActive = useUi((s) => s.setActiveNode);
  return (
    <nav className="node-nav" aria-label="Workstream nodes">
      {STEPS.filter((s) => !s.execPart || showExec).map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && <span className="nn-sep" aria-hidden="true"><IcoArrowRight /></span>}
          <button
            type="button"
            className={`node-nav-step${active === s.key ? " active" : ""}`}
            data-node={s.key}
            disabled={s.key !== "entry"}
            title={s.key !== "entry" ? "Built in a later milestone" : undefined}
            aria-current={active === s.key ? "step" : undefined}
            onClick={() => setActive(s.key)}
          >
            <span className="nn-num">{s.n}</span>{s.label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
