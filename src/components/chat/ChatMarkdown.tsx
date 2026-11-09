import { Fragment } from "react";
import { parseChatMd, type Span } from "@/lib/chat/markdown";

const Spans = ({ spans }: { spans: Span[] }) => (
  <>
    {spans.map((s, i) => (s.b ? <strong key={i}>{s.text}</strong> : s.i ? <em key={i}>{s.text}</em> : <Fragment key={i}>{s.text}</Fragment>))}
  </>
);

/** Renders the small chat markdown subset as React nodes (never as injected HTML). */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseChatMd(text).map((b, i) => {
        if (b.t === "h") return <div key={i} className="msg-h"><Spans spans={b.spans} /></div>;
        if (b.t === "ul") return <ul key={i}>{b.items.map((li, j) => <li key={j}><Spans spans={li} /></li>)}</ul>;
        if (b.t === "table") {
          return (
            <div key={i} className="msg-table-wrap">
              <table className="msg-table">
                <thead><tr>{b.head.map((c, j) => <th key={j}><Spans spans={c} /></th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Spans spans={c} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return (
          <div key={i}>
            {b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Spans spans={l} /></Fragment>)}
          </div>
        );
      })}
    </>
  );
}
