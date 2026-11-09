import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../styles/tokens.css";
import "../styles/entry.css";
import "../styles/app.css";

export const metadata: Metadata = {
  title: "CollabIQ · Workstream",
  description: "Cognitive Workplace: Entry, Intent, Planning, Execution and Workstream result.",
  // No favicon asset yet (an SVG would need a literal color). An empty data URL stops the 404.
  icons: { icon: "data:," },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

/**
 * Theme bootstrap, run before first paint so there is no flash. Same contract as the prototype:
 * data-theme on <html>, saved in localStorage "proto.theme"; with no saved choice the page
 * follows the OS setting (live). The store (src/store/ui.ts) owns changes after hydration.
 */
const THEME_SCRIPT = `(function(){try{
  var KEY='proto.theme',root=document.documentElement,saved=null;
  try{saved=localStorage.getItem(KEY);}catch(e){}
  var mq=window.matchMedia?matchMedia('(prefers-color-scheme: dark)'):null;
  root.setAttribute('data-theme',saved||(mq&&mq.matches?'dark':'light'));
}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
