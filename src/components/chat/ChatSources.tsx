import type { ChatSource } from "@/lib/chat/types";

/** Only web links are rendered as links: a source URL comes from search results, never trusted as-is. */
export const isWebUrl = (u: string): boolean => /^https?:\/\//i.test(u);

export function ChatSources({ sources, title = "Sources", className = "msg-sources" }: { sources: ChatSource[]; title?: string; className?: string }) {
  const safe = sources.filter((s) => isWebUrl(s.url));
  if (!safe.length) return null;
  return (
    <div className={className}>
      <span className="msg-sources-title">{title}</span>
      {safe.map((s) => <a key={s.url} className="msg-source" href={s.url} target="_blank" rel="noopener noreferrer">↗ {s.title}</a>)}
    </div>
  );
}
