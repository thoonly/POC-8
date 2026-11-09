import { create } from "zustand";
import { AiError, isAbort } from "@/lib/ai/errors";
import type { AiErrorCode } from "@/lib/ai/types";
import { draftNodeFromPrompt } from "@/lib/entry/draft";
import { resetDerived } from "./derived";
import { useUi } from "./ui";

export type DraftStatus = "idle" | "drafting" | "ready" | "error";

export interface EntryError {
  code: AiErrorCode | "UNKNOWN";
  message: string;
}

interface EntryState {
  status: DraftStatus;
  error: EntryError | null;
  /** The originating prompt. It is also the language anchor: every answer matches its language. */
  prompt: string;
  nodeName: string;
  context: string;
  topic: string;

  /**
   * Creates (or replaces) the Entry node from a prompt. One AI call: entry:draft-node.
   * Resolves true when the node was created, false when it failed or a newer prompt replaced it.
   */
  start: (prompt: string) => Promise<boolean>;
  /** Re-runs the last prompt after an error (the user pressed "Try again"). */
  retry: () => Promise<boolean>;
  /**
   * Redrafts name, context and topic from a clarified request and makes it the new basis (legacy
   * draftNodeFromPrompt sets window.__topic = the request it was given, so it is also the language
   * anchor from here on). Unlike start() it does not reset the chat or leave the node. A failed
   * draft keeps the old name and context and uses the request itself as the topic. Throws only on abort.
   */
  redraft: (request: string, signal?: AbortSignal) => Promise<void>;
  /** Adds text to the end of the Topic (attached-file notes). */
  appendTopic: (text: string) => void;
  clearError: () => void;
  /** Edits the Topic text (Chat's refine_topic / set_topic). The originating prompt is never changed. */
  setTopic: (topic: string) => void;
}

let inflight: AbortController | null = null;

const toEntryError = (e: unknown): EntryError =>
  e instanceof AiError ? { code: e.code, message: e.message } : { code: "UNKNOWN", message: e instanceof Error ? e.message : "Something went wrong. Try again." };

export const useEntry = create<EntryState>((set, get) => ({
  status: "idle",
  error: null,
  prompt: "",
  nodeName: "Entry node",
  context: "",
  topic: "",

  start: async (prompt) => {
    const raw = prompt.trim();
    if (!raw) return false;
    inflight?.abort(); // a new prompt replaces any draft still running
    const ac = (inflight = new AbortController());
    set({ status: "drafting", error: null, prompt: raw });
    try {
      const draft = await draftNodeFromPrompt(raw, ac.signal);
      if (ac.signal.aborted) return false;
      // The whole basis changed: everything derived from the old prompt resets (document, chat, and
      // later the graph, ledger and grounded statement register themselves in ./derived).
      resetDerived();
      set({ status: "ready", error: null, nodeName: draft.nodeName, context: draft.context, topic: draft.topic });
      useUi.getState().startNode(raw);
      return true;
    } catch (e) {
      if (isAbort(e) || ac.signal.aborted) return false;
      set({ status: "error", error: toEntryError(e) });
      return false;
    } finally {
      if (inflight === ac) inflight = null;
    }
  },

  retry: () => get().start(get().prompt),

  redraft: async (request, signal) => {
    try {
      const draft = await draftNodeFromPrompt(request, signal);
      set({ prompt: request, nodeName: draft.nodeName, context: draft.context, topic: draft.topic });
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw e;
      console.warn("[Entry] redraft failed, using the clarified request as it is", e);
      set({ prompt: request, topic: request });
    }
  },

  appendTopic: (text) => set((s) => ({ topic: s.topic + text })),
  setTopic: (topic) => set({ topic }),
  clearError: () => set({ error: null, status: get().nodeName !== "Entry node" || get().topic ? "ready" : "idle" }),
}));
