"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ai, type AiInfo } from "@/lib/ai/client";
import type { AiError } from "@/lib/ai/errors";
import { reportOf, totalsOf, useUsage } from "@/store/usage";

export interface AiSettingsHandle { open: () => void }

const money = (n: number) => `$${n.toFixed(4)}`;

/**
 * Read-only view of how the SERVER is set up (provider, models, search, whether a key is set) plus
 * this session's usage. Keys are never entered or shown in the browser: they live in .env.local.
 */
export const AiSettings = forwardRef<AiSettingsHandle>(function AiSettings(_props, ref) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<AiInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rows = useUsage((s) => s.rows);
  const reset = useUsage((s) => s.reset);

  const load = () => {
    setErr(null);
    ai.info(true).then(setInfo).catch((e: AiError) => setErr(e.message));
  };
  useImperativeHandle(ref, () => ({ open: () => { load(); dlg.current?.showModal(); } }));
  useEffect(() => { const d = dlg.current; return () => { if (d?.open) d.close(); }; }, []);

  const totals = totalsOf(rows);
  const report = reportOf(rows);

  return (
    <dialog ref={dlg} className="ai-dialog" aria-labelledby="ai-dialog-title" onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
      <div className="ai-dialog__head">
        <h2 id="ai-dialog-title">AI settings</h2>
        <button type="button" className="btn btn-ghost" onClick={() => dlg.current?.close()} autoFocus>Close</button>
      </div>
      <div className="ai-dialog__body">
        <section>
          <h3 className="ai-dialog__h">Server</h3>
          {err && <p className="banner" role="alert">{err}</p>}
          {!info && !err && <p className="ai-usage__empty">Loading…</p>}
          {info && (
            <dl>
              <dt>Provider</dt><dd>{info.mock ? "Mock (AI_MOCK=1, no key and no cost)" : info.provider === "claude" ? "Claude API" : "OpenRouter"}</dd>
              <dt>Key</dt>
              <dd>
                <span className={`ai-status${info.ready ? " ai-status--ok" : ""}`}>
                  {info.ready ? (info.mock ? "Not needed in mock mode" : "Set on the server") : `Missing: add ${info.provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"} to .env.local, then restart`}
                </span>
              </dd>
              <dt>Small model</dt><dd>{info.models.small}</dd>
              <dt>Large model</dt><dd>{info.models.large}</dd>
              <dt>Web search</dt><dd>{info.search === "off" ? "Off" : info.search === "tavily" ? "Tavily" : info.provider === "claude" ? "Claude web search" : "OpenRouter web plugin"}</dd>
            </dl>
          )}
          <p className="ai-dialog__note" style={{ marginTop: 10 }}>
            Keys and models are set in <code>.env.local</code> on the server (see <code>.env.example</code>). The browser never holds a key.
          </p>
        </section>

        <section>
          <h3 className="ai-dialog__h">Usage this session</h3>
          {totals.calls === 0 ? (
            <p className="ai-usage__empty">No AI calls yet.</p>
          ) : (
            <>
              <dl>
                <dt>Calls</dt><dd>{totals.calls}{totals.errors ? `, ${totals.errors} failed` : ""}{totals.truncated ? `, ${totals.truncated} cut off` : ""}</dd>
                <dt>Tokens</dt><dd>{totals.input.toLocaleString()} in{totals.cached ? ` (${totals.cached.toLocaleString()} cached)` : ""} · {totals.output.toLocaleString()} out</dd>
                <dt>Cost</dt><dd>{totals.cost ? `${money(totals.cost)} (estimate)` : "Not reported"}</dd>
              </dl>
              <div className="ai-usage" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr><th>Label</th><th>Tier</th><th>Calls</th><th>Avg in</th><th>Avg out</th><th>Reasoning</th><th>Avg ms</th><th>Cost</th></tr>
                  </thead>
                  <tbody>
                    {report.map((r) => (
                      <tr key={r.label}>
                        <td>{r.label}</td><td>{r.tier}</td>
                        <td className={r.errors || r.truncated ? "is-bad" : undefined}>{r.calls}{r.errors ? ` (${r.errors} failed)` : ""}{r.truncated ? ` (${r.truncated} cut off)` : ""}</td>
                        <td>{r.avgIn}</td><td>{r.avgOut}</td><td>{r.reasoning}</td><td>{r.avgMs}</td><td>{r.cost ? money(r.cost) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ai-dialog__note" style={{ marginTop: 10 }}>
                Check: every call has a real label, no label is called more often than the flow needs, nothing is cut off.
                In the console, <code>__aiUsage()</code> prints this table.
              </p>
              <p style={{ marginTop: 10 }}><button type="button" className="btn btn-ghost" onClick={reset}>Reset usage</button></p>
            </>
          )}
        </section>
      </div>
    </dialog>
  );
});
