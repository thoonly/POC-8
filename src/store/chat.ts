import { create } from "zustand";
import { AiError, isAbort } from "@/lib/ai/errors";
import type { AiErrorCode } from "@/lib/ai/types";
import { routeActions, sanitizeChatActions } from "@/lib/chat/actions";
import { sanitizeChatChoices } from "@/lib/chat/choices";
import type { PromptCtx } from "@/lib/chat/prompts";
import type { GateCardData } from "@/lib/entry/gate";
import { decisionTurn, researchTurn, routeTurn } from "@/lib/chat/turn";
import type { ChatAction, ChatSource, ChoiceGroup, ContextItem, DecisionData, DecisionRequest, HistoryItem, MsgKind } from "@/lib/chat/types";
import { truncateForCard } from "@/lib/text";
import { applyChatAction, readChatDoc, SUPPORTED_OPS } from "./chatApply";
import { onNewBasis } from "./derived";
import { useEntry } from "./entry";
import { useGateRoute } from "./gateRoute";

/**
 * Chat store: the conversation, the context library and the turn runner. One implementation of the
 * turn (legacy runChatTurn, 12573); the pure pieces live in lib/chat and are tested there.
 *
 * Not ported yet, and said so in the conversation when it comes up: "explore more" (needs the
 * graph), facts the user states (need the Grounded statement), regenerate_output (needs generation),
 * PDF/image context files, the "what is missing" gap check, and the Sources panel.
 */

export interface ChatError { code: AiErrorCode | "UNKNOWN"; message: string }

export interface ChatGaps { groups: ChoiceGroup[]; resolved: boolean }

export interface DecisionCardData {
  request: DecisionRequest;
  data: DecisionData;
  sources: ChatSource[];
  chosen: string | null;
}

export type ChatItem =
  | { id: string; type: "user"; text: string }
  | {
      id: string; type: "assistant"; text: string; kind?: MsgKind;
      findings?: string[]; sources?: ChatSource[]; note?: string;
      /** Applied at once (with Undo) and held for confirmation, as decided by the policy. */
      auto?: ChatAction[]; confirm?: ChatAction[];
      choices?: ChoiceGroup[]; choicesSent?: boolean; choicesDismissed?: boolean;
      decision?: DecisionCardData;
      /** A question from the prompt clarity gate, with its options (see store/gate.ts). */
      gate?: GateCardData;
      /** The size questions before a workstream is suggested (see store/gate.ts). Answered or skipped once. */
      gaps?: ChatGaps;
    }
  | { id: string; type: "system"; text: string; error?: ChatError };

interface ChatState {
  items: ChatItem[];
  history: HistoryItem[];
  context: ContextItem[];
  busy: boolean;
  /** The "Thinking…" line shown while a turn runs. */
  status: string | null;
  /** The reply as it is being written (streamed). Replaced by the real message when the turn finishes. */
  draft: string | null;

  send: (text: string) => Promise<void>;
  /** Re-runs the turn that failed, without echoing the user's message again. */
  retry: () => Promise<void>;
  runDecision: (d: Pick<DecisionRequest, "question" | "options"> & { preferences?: DecisionRequest["preferences"] }) => Promise<void>;
  chooseDecision: (msgId: string, option: string) => void;
  answerChoices: (msgId: string, groups: ChoiceGroup[], picked: string[][]) => void;
  dismissChoices: (msgId: string) => void;

  applyAction: (msgId: string, uid: string) => void;
  skipAction: (msgId: string, uid: string) => void;
  undoAction: (msgId: string, uid: string) => void;
  applyAll: (msgId: string) => void;
  skipAll: (msgId: string) => void;

  addContext: (title: string, text: string, kind?: ContextItem["kind"], sources?: ChatSource[]) => ContextItem;
  removeContext: (id: string) => void;
  /** Asks the engine what the given context items change. */
  contextTurn: (items: ContextItem[]) => Promise<void>;
  note: (text: string) => void;
  reset: () => void;

  /**
   * Adds one turn without running the chat engine, and remembers it in the history (legacy
   * addChatMsg + chatHistory.push, as in gateSay). The originating prompt opens the conversation
   * this way. `historyText` is what the model is told was said, when it differs from the bubble.
   * Returns the message id.
   */
  addTurn: (role: "user" | "assistant", text: string, opts?: { historyText?: string; gate?: GateCardData; gaps?: ChatGaps; remember?: boolean }) => string;
  /** Sets or clears the "Thinking…" line without starting a turn (legacy addChatStatus). */
  setStatus: (text: string | null) => void;
  /** Disables every control of a gate card, marking the one pressed. */
  lockGate: (msgId: string, chosen?: string) => void;
  /** Marks a gap-questions card answered or skipped: its chips lock and "Got it" shows. */
  resolveGaps: (msgId: string) => void;
}

let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;
/** Undo closures are not state: they live here, keyed by action uid. */
const undoers = new Map<string, () => void>();
let inflight: AbortController | null = null;
let lastRun: (() => Promise<void>) | null = null;

const toError = (e: unknown): ChatError =>
  e instanceof AiError ? { code: e.code, message: e.message } : { code: "UNKNOWN", message: e instanceof Error ? e.message : "Something went wrong. Try again." };

const mapAction = (list: ChatAction[] | undefined, uid: string, patch: Partial<ChatAction>) =>
  list?.map((a) => (a.uid === uid ? { ...a, ...patch } : a));

export const useChat = create<ChatState>((set, get) => {
  const ctx = (): PromptCtx => ({ doc: readChatDoc(), context: get().context, history: get().history, anchor: useEntry.getState().prompt });
  const push = (item: ChatItem) => set((s) => ({ items: [...s.items, item] }));
  const patch = (id: string, fn: (m: Extract<ChatItem, { type: "assistant" }>) => Partial<Extract<ChatItem, { type: "assistant" }>>) =>
    set((s) => ({ items: s.items.map((m) => (m.id === id && m.type === "assistant" ? { ...m, ...fn(m) } : m)) }));
  const say = (text: string, kind?: MsgKind, extra: Partial<Extract<ChatItem, { type: "assistant" }>> = {}): string => {
    const id = nextId("m");
    push({ id, type: "assistant", text, kind, ...extra });
    return id;
  };
  const system = (text: string, error?: ChatError) => push({ id: nextId("m"), type: "system", text, error });
  const remember = (role: HistoryItem["role"], text: string) => set((s) => ({ history: [...s.history, { role, text }] }));

  /** Wraps a turn: one at a time, abortable, with the error state shown in the conversation. */
  async function run(label: string, body: (signal: AbortSignal) => Promise<void>) {
    if (get().busy) { system("One moment — finishing the current reply first."); return; }
    const ac = (inflight = new AbortController());
    set({ busy: true, status: label });
    lastRun = () => run(label, body);
    try {
      await body(ac.signal);
    } catch (e) {
      if (isAbort(e) || ac.signal.aborted) return;
      if (!(e instanceof AiError)) console.error(e); // AiErrors are expected states, shown in the chat
      const err = toError(e);
      system(err.message, err);
    } finally {
      if (inflight === ac) { inflight = null; set({ busy: false, status: null, draft: null }); }
    }
  }

  /** Sanitizes proposed actions against the live document, applies the safe ones, queues the rest. */
  function routeAndApply(msgId: string, raw: unknown[], fromResearch: boolean): number {
    const doc = readChatDoc();
    const acts = routeActions(sanitizeChatActions(raw, doc, { allowed: SUPPORTED_OPS, uid: () => nextId("a") }), { fromResearch }, doc);
    const confirm = acts.filter((a) => a.needsConfirm);
    const auto = acts.filter((a) => !a.needsConfirm);
    patch(msgId, () => ({ confirm: confirm.length ? confirm : undefined, auto: auto.length ? auto : undefined }));
    auto.forEach((a) => get().applyAction(msgId, a.uid));
    return acts.length;
  }

  async function runDecisionCore(d: DecisionRequest, signal: AbortSignal) {
    set({ status: "Comparing the options — searching the web where facts matter…" });
    const { data, sources } = await decisionTurn(ctx(), d, signal);
    if (signal.aborted) return;
    if (!data.options.length) {
      system("I couldn’t build a clear comparison for that — try rephrasing the decision.");
      return;
    }
    remember("assistant", `Compared options for "${d.question}": ` + data.options.map((o) => `${o.option} (${o.fit})`).join(", ")
      + (data.recommendation ? `. Recommended: ${data.recommendation.option} — ${data.recommendation.why}` : ". Needs more preferences to recommend."));
    say(data.intro || "Here’s how the options compare:", "decision", { decision: { request: d, data, sources, chosen: null } });
  }

  async function turn(userText: string, isContextTurn: boolean, signal: AbortSignal) {
    const r = await routeTurn(ctx(), userText, isContextTurn, signal, (text) => { if (!signal.aborted) set({ draft: text }); });
    if (signal.aborted) return;
    set({ draft: null }); // the real message below replaces the live draft in the same render

    if (r.exploreMore) {
      say(r.reply || "Exploring more ideas needs the Cognitive Field graph.", "command", { note: "The Cognitive Field is not built in this version yet, so nothing was added." });
      remember("assistant", r.reply);
      return;
    }
    if (r.presentation) {
      const msg = "Presentations are made from the finished work: create a workstream, complete its nodes, then use Presentation in the Workstream result.";
      say(msg, "question");
      remember("assistant", msg);
      return;
    }
    if (r.decisionHelp) {
      if (r.reply.trim()) say(r.reply); // the one-sentence lead-in (the prompt asks for exactly that); the card below carries the "Decision help" pill
      remember("assistant", `(Comparing options for: ${r.decisionHelp.question})`);
      await runDecisionCore({ question: r.decisionHelp.question, options: r.decisionHelp.options, preferences: [] }, signal);
      return;
    }

    if (r.needsResearch) {
      set({ status: `Searching the web${r.searchQuery ? ` for "${truncateForCard(r.searchQuery, 60)}"` : ""}…` });
      const res = await researchTurn(ctx(), userText, r.searchQuery, signal);
      if (signal.aborted) return;
      if (!res) {
        say(r.reply || "I can’t search the web right now.", "research");
        remember("assistant", r.reply);
        system("Web search is off on the server, so nothing was looked up. Set AI_SEARCH in .env.local to turn it on.");
        return;
      }
      const reply = res.reply || (res.findings.length ? "" : "I searched but could not pull out a clear answer — try narrowing the question.");
      const id = say(reply, "research", { findings: res.findings, sources: res.sources });
      remember("assistant", [reply, ...res.findings].join(" • "));
      if (reply || res.findings.length) {
        get().addContext(
          res.contextTitle || truncateForCard(r.searchQuery || userText, 40),
          [reply, ...res.findings.map((f) => "- " + f)].join("\n") + (res.sources.length ? "\nSources: " + res.sources.map((s) => s.url).join(", ") : ""),
          "research",
          res.sources,
        );
      }
      routeAndApply(id, res.actions, true);
      const choices = sanitizeChatChoices(res.choices);
      if (choices.length) patch(id, () => ({ choices }));
      return;
    }

    const id = say(r.reply || "Done.", r.kind);
    remember("assistant", r.reply);
    const proposed = routeAndApply(id, r.actions, false);
    const choices = sanitizeChatChoices(r.choices);
    if (choices.length) patch(id, () => ({ choices }));
    if (r.kind === "command" && r.actions.length && !proposed) {
      system("No change was applied — it either duplicated what’s already there, pointed at something that doesn’t exist, or isn’t possible yet at this stage.");
    }
  }

  return {
    items: [], history: [], context: [], busy: false, status: null, draft: null,

    send: async (text) => {
      const t = text.trim();
      if (!t) return;
      if (get().busy) { system("One moment — finishing the current reply first."); return; }
      // Chat is clarifying the prompt: a typed message is the answer, not a normal chat turn (legacy 12707).
      const gate = useGateRoute.getState().route;
      if (gate) {
        if (!gate.onText) { system("One moment — finishing the current reply first."); return; }
        push({ id: nextId("m"), type: "user", text: t });
        remember("user", t);
        gate.onText(t);
        return;
      }
      push({ id: nextId("m"), type: "user", text: t });
      remember("user", t);
      await run("Thinking…", (signal) => turn(t, false, signal));
    },

    retry: async () => {
      const again = lastRun;
      if (!again || get().busy) return;
      set((s) => ({ items: s.items.filter((m) => !(m.type === "system" && m.error)) }));
      await again();
    },

    runDecision: async (d) => {
      if (get().busy) { system("One moment — finishing the current reply first."); return; }
      const request: DecisionRequest = { question: d.question, options: d.options, preferences: d.preferences ?? [] };
      const label = request.preferences.length
        ? `My preferences for "${request.question}":\n${request.preferences.map((p) => `- ${p.q} → ${p.a}`).join("\n")}`
        : `Help me decide: ${request.question}`;
      push({ id: nextId("m"), type: "user", text: label });
      remember("user", label);
      await run(request.preferences.length ? "Re-ranking the options for you…" : "Weighing the options…", (signal) => runDecisionCore(request, signal));
    },

    chooseDecision: (msgId, option) => {
      const m = get().items.find((x) => x.id === msgId);
      if (!m || m.type !== "assistant" || !m.decision || get().busy) return;
      patch(msgId, (cur) => ({ decision: cur.decision && { ...cur.decision, chosen: option } }));
      void get().send(`Use this: ${m.decision.request.question} → ${option}`);
    },

    answerChoices: (msgId, groups, picked) => {
      if (get().busy) { system("One moment — finishing the current reply first."); return; }
      const lines = groups.map((g, gi) => (picked[gi]?.length ? `${g.prompt} → ${picked[gi].join(", ")}` : null)).filter((l): l is string => !!l);
      if (!lines.length) return;
      patch(msgId, () => ({ choicesSent: true }));
      void get().send(lines.length === 1 ? `Use this: ${lines[0]}` : `My answers — use them:\n${lines.map((l) => "- " + l).join("\n")}`);
    },

    dismissChoices: (msgId) => patch(msgId, () => ({ choicesDismissed: true })),

    applyAction: (msgId, uid) => {
      const m = get().items.find((x) => x.id === msgId);
      if (!m || m.type !== "assistant") return;
      const a = [...(m.auto ?? []), ...(m.confirm ?? [])].find((x) => x.uid === uid);
      if (!a || a.state !== "pending") return;
      let res: ReturnType<typeof applyChatAction>;
      try { res = applyChatAction(a); } catch (e) { console.error(e); res = { ok: false, msg: "Something went wrong applying this" }; }
      if (res.undo) undoers.set(uid, res.undo);
      const change: Partial<ChatAction> = res.ok ? { state: "applied", undoable: !!res.undo } : { state: "stale", staleMsg: res.msg };
      patch(msgId, (cur) => ({ auto: mapAction(cur.auto, uid, change), confirm: mapAction(cur.confirm, uid, change) }));
    },

    skipAction: (msgId, uid) => patch(msgId, (cur) => ({ auto: mapAction(cur.auto, uid, { state: "skipped" }), confirm: mapAction(cur.confirm, uid, { state: "skipped" }) })),

    undoAction: (msgId, uid) => {
      try { undoers.get(uid)?.(); } catch (e) { console.error(e); }
      undoers.delete(uid);
      patch(msgId, (cur) => ({ auto: mapAction(cur.auto, uid, { state: "undone", undoable: false }), confirm: mapAction(cur.confirm, uid, { state: "undone", undoable: false }) }));
    },

    applyAll: (msgId) => {
      const m = get().items.find((x) => x.id === msgId);
      if (m?.type === "assistant") (m.confirm ?? []).filter((a) => a.state === "pending").forEach((a) => get().applyAction(msgId, a.uid));
    },
    skipAll: (msgId) => {
      const m = get().items.find((x) => x.id === msgId);
      if (m?.type === "assistant") (m.confirm ?? []).filter((a) => a.state === "pending").forEach((a) => get().skipAction(msgId, a.uid));
    },

    addContext: (title, text, kind = "text", sources = []) => {
      const c: ContextItem = { id: nextId("ctx-"), title, kind, text, sources, loading: false };
      set((s) => ({ context: [...s.context, c] }));
      return c;
    },
    removeContext: (id) => set((s) => ({ context: s.context.filter((c) => c.id !== id) })),

    contextTurn: async (items) => {
      if (get().busy) { system("One moment — finishing the current reply first."); return; }
      // The file answers Chat's clarifying question instead of updating the exploration (legacy 12844).
      const gate = useGateRoute.getState().route;
      if (gate) { gate.onFiles?.(items); return; }
      system(`Added context: ${items.map((i) => `"${i.title}"`).join(", ")} — checking what it changes…`);
      const text = `The user added context item(s) ${items.map((i) => `[${i.id}] "${i.title}"`).join(", ")}. Read them in the CONTEXT LIBRARY, then propose the document updates this context clearly supports.`;
      await run("Reading the new context…", (signal) => turn(text, true, signal));
    },

    note: (text) => system(text),

    addTurn: (role, text, opts) => {
      const id = nextId("m");
      push(role === "user" ? { id, type: "user", text } : { id, type: "assistant", text, gate: opts?.gate, gaps: opts?.gaps });
      if (opts?.remember !== false) remember(role, opts?.historyText ?? text);
      return id;
    },

    setStatus: (text) => set({ status: text }),

    lockGate: (msgId, chosen) => patch(msgId, (m) => ({ gate: m.gate && { ...m.gate, locked: true, chosen: chosen ?? m.gate.chosen } })),

    resolveGaps: (msgId) => patch(msgId, (m) => ({ gaps: m.gaps && { ...m.gaps, resolved: true } })),

    reset: () => {
      inflight?.abort();
      inflight = null; lastRun = null;
      undoers.clear();
      set({ items: [], history: [], context: [], busy: false, status: null, draft: null });
    },
  };
});

onNewBasis(() => useChat.getState().reset());

/** Number of proposed changes still waiting for the user. */
export const pendingCount = (items: ChatItem[]): number =>
  items.reduce((n, m) => n + (m.type === "assistant" ? (m.confirm ?? []).filter((a) => a.state === "pending").length : 0), 0);
