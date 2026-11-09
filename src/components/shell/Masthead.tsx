"use client";

import { useUi } from "@/store/ui";
import { IcoHome, IcoPanels2, IcoPanels3 } from "../ui/Ico";

export function Masthead({ nodeName, onOpenAiSettings }: { nodeName: string; onOpenAiSettings: () => void }) {
  const layout = useUi((s) => s.layout);
  const setLayout = useUi((s) => s.setLayout);
  const goHome = useUi((s) => s.goHome);
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const hydrated = useUi((s) => s.hydrated);

  return (
    <div className="masthead">
      <div className="masthead-brand"><span className="masthead-logo">◆</span> CollabIQ</div>
      <div className="masthead-crumb">
        Workspace <span className="masthead-crumb-sep">/</span> <span id="masthead-node-name">{nodeName}</span>
      </div>
      <button className="masthead-prompt-btn" type="button" onClick={goHome} title="Back to the start page to change your prompt">
        <IcoHome />Home
      </button>
      <div className="cf-mode-toggle">
        <button type="button" className={`cf-mode-btn${layout === "2panel" ? " active" : ""}`} onClick={() => setLayout("2panel")} title="2 panels: Cognitive Field, Output">
          <IcoPanels2 />2 panel
        </button>
        <button type="button" className={`cf-mode-btn${layout === "3panel" ? " active" : ""}`} onClick={() => setLayout("3panel")} title="3 panels: Chat, Cognitive Field, Output">
          <IcoPanels3 />3 panel
        </button>
      </div>
      <div className="masthead-tools">
        <button type="button" className="masthead-prompt-btn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} suppressHydrationWarning>
          {hydrated && theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button type="button" className="masthead-prompt-btn" onClick={onOpenAiSettings}>AI settings</button>
      </div>
    </div>
  );
}
