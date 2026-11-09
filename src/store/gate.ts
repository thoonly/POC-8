/**
 * What happens after "Create entry node": draft the node, open the conversation with the person's
 * own prompt, then run the prompt clarity gate in Chat. One implementation of legacy
 * entry-v4.html 11841-11921 (the click handler), runPromptGate (10520) and presentWeakPromptNote
 * (10690). The pure parts are in lib/entry/gate.ts and tested there.
 *
 *   startEntryNode(prompt)
 *     1. clearPromptGate()          a new prompt replaces any clarification still waiting in Chat
 *     2. entry.start(prompt)        call 1, entry:draft-node; resets everything derived (incl. the chat)
 *     3. chat.addTurn("user", …)    the person's own prompt is the first bubble
 *     4. runPromptGate()            call 2, entry:prompt-gate; blocks in Chat until the request is clear
 *          └ redraft              call 3, entry:draft-node again, only if the request changed
 *     5. presentWeakPromptNote()    broad / multi: optional narrower prompts; picking one starts again at 1
 *     6. runGapStep()               call 4, entry:gap-analysis; "A few quick questions first" card, or nothing
 *          Skip → a note;  Continue → the answers go to the ledger and into the Topic ("Additional details")
 *
 * AI calls per click, as in legacy: 4 (5 when the gate redrafts), above the CLAUDE.md limit of 3.
 * Ported 1:1 on the user's decision ("keep calls 1:1 with legacy"). The Grounded statement, when it
 * lands, adds a fifth (sixth).
 *
 * Not ported yet (legacy beginGroundedFlow, 10721): panel collapse and the empty Cognitive Field
 * while the gate blocks; then the Grounded statement and its categories (legacy calls it from the
 * gap card's onResolve, with the list of questions left unanswered). Today the flow ends after step 6
 * and Chat behaves normally.
 *
 * Handlers (what a card's buttons do) are closures, so they are not state: they live here, keyed
 * by message id, like the undo closures in store/chat.ts.
 */
import { isAbort } from "@/lib/ai/errors";
import {
  PROMPT_GATE_MAX_ROUNDS, ambiguousDefault, ambiguousMessage, classifyPromptClarity, fallbackMerge, fileNote, incompleteMessage,
  resolveGateStep, unclearMessage, weakPromptNote, type Clarity, type GateCardData, type GateItem, type GateTurn,
} from "@/lib/entry/gate";
import type { ChoiceGroup } from "@/lib/chat/types";
import { answerLines, runGapAnalysis, withAdditionalDetails } from "@/lib/entry/gaps";
import { useChat } from "./chat";
import { useEntry } from "./entry";
import { useGateRoute } from "./gateRoute";
import { useLedger } from "./ledger";

type CardButton = GateCardData["buttons"][number];
interface Handlers { pick?: (item: GateItem, index: number) => void; press: Record<string, () => void> }

/** Bumps on every new prompt, so a check still running for the old one can't act on the new one. */
let seq = 0;
let inflight: AbortController | null = null;
/** Releases the running gate's promise when its prompt is replaced (legacy left it pending forever). */
let cancelGate: (() => void) | null = null;
const handlers = new Map<string, Handlers>();
/** What the gap-questions card's two buttons do, keyed by message id. */
const gapHandlers = new Map<string, { skip: () => void; send: (groups: ChoiceGroup[], picked: string[][]) => void }>();

const chat = () => useChat.getState();
const setRoute = useGateRoute.getState().setRoute;

type GateResult = { stale: true } | { stale: false; weak: Clarity | null };

/** Drops whatever the gate was doing: cancels its calls, forgets its cards' handlers, frees the composer. */
export function clearPromptGate(): void {
  seq++;
  inflight?.abort();
  inflight = null;
  const release = cancelGate;
  cancelGate = null;
  release?.();
  handlers.clear();
  gapHandlers.clear();
  setRoute(null);
  chat().setStatus(null);
}

/** What a card's controls call. */
export const gateActions = {
  pick(msgId: string, index: number): void {
    const h = handlers.get(msgId);
    const item = chat().items.find((m) => m.id === msgId);
    const card = item?.type === "assistant" ? item.gate : undefined;
    if (!h?.pick || !card || card.locked) return;
    chat().lockGate(msgId, `o:${index}`);
    h.pick(card.options[index], index);
  },
  press(msgId: string, buttonId: string): void {
    const h = handlers.get(msgId);
    const item = chat().items.find((m) => m.id === msgId);
    const card = item?.type === "assistant" ? item.gate : undefined;
    if (!h || !card || card.locked) return;
    // "Attach a file" and "Add more details" keep the card open: the person may still answer another way.
    if (buttonId !== "attach" && buttonId !== "details") chat().lockGate(msgId, `b:${buttonId}`);
    h.press[buttonId]?.();
  },
};

/** What the gap-questions card calls. A card whose prompt was replaced has no handler and does nothing. */
export const gapActions = {
  skip: (msgId: string): void => gapHandlers.get(msgId)?.skip(),
  send: (msgId: string, groups: ChoiceGroup[], picked: string[][]): void => gapHandlers.get(msgId)?.send(groups, picked),
};

const focusComposer =() => { if (typeof document !== "undefined") document.getElementById("uib-input")?.focus(); };

/** Posts an assistant message with a card of options under it. Returns the message id. */
function postCard(
  text: string,
  card: Pick<GateCardData, "options" | "letters" | "hint"> & { buttons?: CardButton[] },
  h: Handlers,
  historyText?: string,
): string {
  const id = chat().addTurn("assistant", text, { historyText, gate: { options: card.options, letters: card.letters, hint: card.hint, buttons: card.buttons ?? [], locked: false } });
  handlers.set(id, h);
  return id;
}

/**
 * Resolves once work can start, with the broad / multi verdict (or null). Resolves { stale: true }
 * for a prompt that was replaced in the meantime. Legacy runPromptGate: the same check → ask →
 * answer → check loop, with the answers kept as `turns`.
 */
function runPromptGate(mySeq: number, original: string): Promise<GateResult> {
  return new Promise((resolve) => {
    const ac = (inflight = new AbortController());
    const turns: GateTurn[] = [];
    const attachments: string[] = [];   // file names attached while the gate was open
    let fileNotes = "";                 // short excerpts of those files, carried into the topic
    let rounds = 0;
    let openCard: string | null = null; // the card still waiting, locked when the person answers some other way

    const stale = () => mySeq !== seq;
    const bail = () => resolve({ stale: true });
    cancelGate = bail;
    const say = (role: "user" | "assistant", text: string) => chat().addTurn(role, text);

    function answered(q: string, a: string) {
      if (openCard) { chat().lockGate(openCard); handlers.delete(openCard); openCard = null; }
      turns.push({ q, a });
    }
    function addFiles(list: { title: string; text: string }[]) {
      list.forEach((i) => { attachments.push(i.title); fileNotes += fileNote(i.title, i.text); });
    }
    function waitFor(q: string, extra?: { onFiles?: (items: { title: string; text: string }[]) => void }) {
      setRoute({
        onText: (text) => { answered(q, text); void check(); },
        onFiles: (list) => { addFiles(list); answered(q, "Attached " + list.map((i) => i.title).join(", ")); void check(); },
        ...extra,
      });
    }
    const continueAnyway = (target: string): CardButton & { run: () => void } => ({
      id: "continue", label: "Continue anyway",
      run: () => { say("user", "Continue anyway"); void finish(target, null); },
    });
    const buttonsOf = (defs: (CardButton & { run: () => void })[]) => ({
      buttons: defs.map(({ id, label, primary }) => ({ id, label, primary })),
      press: Object.fromEntries(defs.map((d) => [d.id, d.run])),
    });

    async function finish(target: string, weak: Clarity | null) {
      if (stale()) return bail();
      if (openCard) { chat().lockGate(openCard); handlers.delete(openCard); openCard = null; }
      setRoute({});
      target = target.trim() || original;
      if (target !== original || fileNotes) {
        chat().setStatus("Updating your request…");
        try {
          await useEntry.getState().redraft(target, ac.signal);
        } catch (e) {
          if (!isAbort(e)) console.error(e);
          return bail(); // aborted: a new prompt took over
        }
        chat().setStatus(null);
        if (stale()) return bail();
        if (fileNotes) useEntry.getState().appendTopic("\n\nAttached files:" + fileNotes);
        chat().note(`Updated your request: “${target}”`);
      }
      setRoute(null);
      resolve({ stale: false, weak });
    }

    async function check() {
      if (stale()) return bail();
      setRoute({}); // typed messages wait instead of going to the normal chat router
      chat().setStatus(turns.length ? "Checking what that tells me…" : "Reading your request…");
      let res: Clarity | null = null;
      try {
        res = await classifyPromptClarity(original, turns, attachments, ac.signal);
      } catch (e) {
        if (isAbort(e)) return bail();
        // A failed check never strands the person: carry on without it.
        console.warn("[Prompt gate] clarity check failed, carrying on without it", e);
      }
      chat().setStatus(null);
      if (stale()) return bail();

      const step = resolveGateStep(res, { original, turns, attachments });
      switch (step.kind) {
        case "unclear": return askUnclear(step.res);
        case "incomplete": return askIncomplete(step.res, step.merged);
        case "ambiguous": return askAmbiguous(step.res, step.merged, step.items);
        case "finish": return void finish(step.target, step.weak);
      }
    }

    // Blocking, until the person answers: asks what the typed words mean.
    function askUnclear(res: Clarity) {
      rounds++;
      const { intro, options, historyText } = unclearMessage(res, original);
      const btns = rounds >= PROMPT_GATE_MAX_ROUNDS ? buttonsOf([continueAnyway(fallbackMerge(original, turns))]) : buttonsOf([]);
      openCard = postCard(intro, {
        options, letters: true,
        hint: options.length ? "Pick one, or type what you mean below." : "Type what you mean below.",
        buttons: btns.buttons,
      }, {
        press: btns.press,
        pick: (o, i) => {
          openCard = null;
          say("user", `${"ABC"[i]}. ${o.label}`);
          turns.push({ q: intro, a: o.detail ? `${o.prompt} (${o.detail})` : o.prompt });
          void check();
        },
      }, historyText);
      waitFor(intro);
      focusComposer();
    }

    // Restates the intent; Attach a file / Add more details / Continue anyway.
    function askIncomplete(res: Clarity, merged: string) {
      rounds++;
      const msg = incompleteMessage(res);
      const onFiles = (list: { title: string; text: string }[]) => {
        addFiles(list);
        answered(msg, "Attached " + list.map((i) => i.title).join(", "));
        void finish(`${merged} (${list.map((i) => i.title).join(", ")})`, null);
      };
      const btns = buttonsOf([
        // The file picker is opened by the component (it owns the file input); see GateCard.
        { id: "attach", label: "Attach a file", primary: true, run: () => {} },
        { id: "details", label: "Add more details", run: () => { focusComposer(); chat().note("Type the details below and press Enter."); } },
        continueAnyway(turns.length ? merged : original),
      ]);
      openCard = postCard(msg, { options: [], letters: false, buttons: btns.buttons }, { press: btns.press });
      waitFor(msg, { onFiles });
    }

    // Lists the meanings; None of these / Continue anyway (the most common meaning).
    function askAmbiguous(res: Clarity, merged: string, list: GateItem[]) {
      rounds++;
      const msg = ambiguousMessage(res);
      const def = ambiguousDefault(res, list);
      const term = res.term.trim();
      const btns = buttonsOf([
        {
          id: "none", label: "None of these",
          run: () => {
            openCard = null;
            say("user", "None of these");
            const ask = term ? `No problem. In your own words, what do you mean by “${term}”?` : "No problem. In your own words, what do you mean?";
            say("assistant", ask);
            waitFor(ask);
            focusComposer();
          },
        },
        {
          id: "continue", label: "Continue anyway",
          run: () => {
            say("user", "Continue anyway");
            chat().note(`Going with the most common meaning: ${def.label}.`);
            void finish(def.prompt, null);
          },
        },
      ]);
      openCard = postCard(msg, { options: list, letters: false, buttons: btns.buttons }, {
        press: btns.press,
        pick: (it) => { openCard = null; say("user", it.label); turns.push({ q: msg, a: it.label }); void finish(it.prompt, null); },
      });
      waitFor(msg);
    }

    void check();
  });
}

/** Non-blocking: the flow goes on; this only offers a narrower prompt or one of the separate requests. */
function presentWeakPromptNote(weak: Clarity): void {
  const note = weakPromptNote(weak);
  if (!note) return;
  postCard(note.message, { options: note.items, letters: false, hint: note.hint }, {
    press: {},
    // A narrower prompt is a new basis: the same path as pressing "Create entry node".
    pick: (it) => { void startEntryNode(it.prompt); },
  });
}

/**
 * Asks whether the size of the work is already clear (legacy beginGroundedFlow 10747-10758 and
 * presentGapQuestions 10314). Never blocks: a failed check says so and the flow carries on, and the
 * card does not hold the composer, so the person may also just keep typing in Chat.
 */
async function runGapStep(mySeq: number): Promise<void> {
  const { topic: current, prompt } = useEntry.getState(); // the gate may have redrafted the topic from the clarified request
  const topic = current.trim();
  if (!topic) return;
  const ac = (inflight = new AbortController());
  chat().setStatus("Checking what's missing from this prompt…");
  let res: Awaited<ReturnType<typeof runGapAnalysis>>;
  try {
    res = await runGapAnalysis(topic, prompt, useLedger.getState().entries, ac.signal);
  } catch (e) {
    if (!isAbort(e)) console.error(e);
    return; // aborted: a new prompt took over and has already cleared the status
  }
  if (mySeq !== seq) return;
  chat().setStatus(null);
  if (!res.ok) chat().note("I couldn't check what's missing from this prompt, so I went ahead without questions. Tell me any details in Chat.");
  if (!res.gaps.length) return;

  // Not remembered in the history: legacy shows this as a bubble only (addChatMsg, not chatHistory).
  const id = chat().addTurn(
    "assistant",
    "Before I suggest a workstream, a few answers will tell me how big this work is. Skip if you'd rather I use my best judgment.",
    { gaps: { groups: res.gaps, resolved: false }, remember: false },
  );
  const done = () => { chat().resolveGaps(id); gapHandlers.delete(id); };
  gapHandlers.set(id, {
    skip: () => {
      done();
      chat().note("Skipped — using my best judgment.");
    },
    send: (groups, picked) => {
      const lines = answerLines(groups, picked);
      if (!lines.length) return;
      // Whatever was left blank stays an open question (legacy hands these to the Grounded statement).
      groups.forEach((g, i) => { if (picked[i]?.length) useLedger.getState().add(g.prompt, picked[i].join(", "), "entry"); });
      done();
      useEntry.getState().setTopic(withAdditionalDetails(topic, lines));
    },
  });
}

/** The "Create entry node" click. Resolves when the gate has finished (or the prompt was replaced). */
export async function startEntryNode(prompt: string): Promise<void> {
  const raw = prompt.trim();
  if (!raw) return;
  clearPromptGate();
  const mySeq = seq;
  const created = await useEntry.getState().start(raw);
  if (!created || mySeq !== seq) return; // failed (the banner shows it), or a newer prompt took over
  chat().addTurn("user", raw);
  const gate = await runPromptGate(mySeq, useEntry.getState().prompt);
  if (gate.stale || mySeq !== seq) return;
  if (gate.weak) presentWeakPromptNote(gate.weak);
  await runGapStep(mySeq);
}

/** "Try again" after a failed draft. */
export const retryEntryNode = (): Promise<void> => startEntryNode(useEntry.getState().prompt);
