"use client";

import { useEffect, useRef } from "react";
import "@/store/chat"; // registers the chat reset for a new prompt
import { useDocument } from "@/store/document";
import { useEntry } from "@/store/entry";
import { retryEntryNode, startEntryNode } from "@/store/gate";
import { useUi } from "@/store/ui";
import "@/store/usage"; // registers the usage listener
import { ChatPanel } from "./chat/ChatPanel";
import { AiSettings, type AiSettingsHandle } from "./dialogs/AiSettings";
import { Banner } from "./dialogs/Banner";
import { HomeView } from "./shell/HomeView";
import { Masthead } from "./shell/Masthead";
import { NodeNav } from "./shell/NodeNav";
import { IcoChat, IcoField, IcoOutput } from "./ui/Ico";

export function Workspace() {
  const settings = useRef<AiSettingsHandle>(null);
  const openSettings = () => settings.current?.open();

  const hydrate = useUi((s) => s.hydrate);
  const screen = useUi((s) => s.screen);
  const layout = useUi((s) => s.layout);
  const uiPrompt = useUi((s) => s.prompt);

  const { status, error, nodeName, context, topic, prompt, clearError } = useEntry();
  const notes = useDocument((s) => s.notes);

  useEffect(() => hydrate(), [hydrate]);

  const hasNode = !!uiPrompt;
  const drafting = status === "drafting";

  return (
    <>
      {hasNode && (
        <div className="wrap">
          <Masthead nodeName={nodeName} onOpenAiSettings={openSettings} />
          <NodeNav />
          <div className="split-view" id="split-view">
            {layout === "3panel" && (
              <>
                <div className="split-col split-col-chat" id="chat-panel-col">
                  <div className="split-col-label cf-label-row">
                    <span className="panel-title"><IcoChat />Chat</span>
                  </div>
                  <div className="panel-body">
                    <ChatPanel onOpenAiSettings={openSettings} />
                  </div>
                </div>
                <div className="panel-resize-handle" id="resize-chat-graph" />
              </>
            )}

            <div className="split-col split-col-graph" id="cognitive-field-col">
              <div className="split-col-label cf-label-row">
                <span className="panel-title"><IcoField />Cognitive Field</span>
              </div>
              <p className="ws-pending">The graph, text, scratch pad and sources views arrive in a later step of Milestone 1.</p>
              {/* With two panels Chat has no column of its own: it sits in the Cognitive Field, as in the prototype. */}
              {layout === "2panel" && <div className="ws-chat-inline"><ChatPanel onOpenAiSettings={openSettings} /></div>}
            </div>

            <div className={`panel-resize-handle${layout === "2panel" ? " inert" : ""}`} id="resize-graph-output" />

            <div className="split-col split-col-output" id="output-col">
              <div className="output-card">
                <div className="split-col-label output-card-header cf-label-row">
                  <span className="panel-title"><IcoOutput />Output<span className="output-header-meta">Updates with the chat</span></span>
                </div>
                <div className="ws-draft">
                  <div>
                    <p className="ws-draft__label">Originating prompt</p>
                    <p>{prompt}</p>
                  </div>
                  {context && <div><p className="ws-draft__label">Context</p><p>{context}</p></div>}
                  {topic && <div><p className="ws-draft__label">Topic</p><p>{topic}</p></div>}
                  {notes.length > 0 && (
                    <div>
                      <p className="ws-draft__label">Scratch pad notes</p>
                      {notes.map((n) => <p key={n.id}>{n.text}</p>)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {screen === "home" && (
        <>
          <HomeView
            key={hasNode ? `node:${prompt}` : "new"}
            hasNode={hasNode}
            currentPrompt={prompt}
            busy={drafting}
            onSubmit={(p) => void startEntryNode(p)}
            onOpenAiSettings={openSettings}
          />
          {error && (
            <div style={{ position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 1600, maxWidth: 640, margin: "0 auto" }}>
              <Banner error={error} onRetry={() => void retryEntryNode()} onOpenSettings={openSettings} onDismiss={clearError} />
            </div>
          )}
        </>
      )}

      <AiSettings ref={settings} />
    </>
  );
}
