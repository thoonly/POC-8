import { locate } from "@/lib/chat/actions";
import type { ChatAction, ChatDoc, ChatOp } from "@/lib/chat/types";
import { useDocument } from "./document";
import { useEntry } from "./entry";

/** The document as the chat engine sees it. */
export function readChatDoc(): ChatDoc {
  const e = useEntry.getState();
  const d = useDocument.getState();
  return { topic: e.topic, answer: d.answer, generated: d.generated, categories: d.categories, actions: d.actions, notes: d.notes.map((n) => n.text) };
}

/**
 * Ops this build can apply. regenerate_output needs the graph/answer generation, which is not
 * ported yet, so a proposal for it is dropped at sanitize time instead of showing a dead button.
 */
export const SUPPORTED_OPS: ReadonlySet<ChatOp> = new Set<ChatOp>([
  "refine_topic", "set_topic", "refine_answer", "set_answer", "add_category", "add_topic",
  "add_suggested_action", "add_available_action", "add_scratch_note", "edit_item", "remove_item",
]);

export interface ApplyResult { ok: boolean; undo?: () => void; msg?: string }

/** Applies one action to the stores. Mirrors legacy applyChatAction (12385). */
export function applyChatAction(a: ChatAction): ApplyResult {
  const entry = useEntry.getState();
  const doc = useDocument.getState();
  switch (a.op) {
    case "refine_topic": case "set_topic": {
      const prev = entry.topic;
      entry.setTopic(a.value);
      return {
        ok: true,
        undo: () => {
          if (useEntry.getState().topic !== a.value && !window.confirm("The Topic was edited after this change. Undo anyway and restore the earlier Topic?")) return;
          useEntry.getState().setTopic(prev);
        },
      };
    }
    case "refine_answer": case "set_answer": {
      const prev = doc.answer;
      doc.setAnswer(a.value);
      return {
        ok: true,
        undo: () => {
          if (useDocument.getState().answer !== a.value && !window.confirm("The Answer was edited after this change. Undo anyway and restore the earlier Answer?")) return;
          useDocument.getState().setAnswer(prev);
        },
      };
    }
    case "add_category": {
      doc.addCategory(a.value);
      return { ok: true, undo: () => { const i = useDocument.getState().categories.findIndex((c) => c.label === a.value); if (i !== -1) useDocument.getState().removeCategory(i); } };
    }
    case "add_topic": {
      const ci = doc.categories.findIndex((c) => c.label === a.targetCatText);
      if (ci === -1) return { ok: false, msg: "That category changed since this was proposed" };
      doc.addTopic(ci, a.value);
      return {
        ok: true,
        undo: () => {
          const s = useDocument.getState();
          const c = s.categories.findIndex((x) => x.label === a.targetCatText);
          const t = c === -1 ? -1 : s.categories[c].topics.indexOf(a.value);
          if (t !== -1) s.removeTopic(c, t);
        },
      };
    }
    case "add_suggested_action": case "add_available_action": {
      doc.addAction(a.value, a.op === "add_suggested_action" ? "suggested" : "available");
      return { ok: true, undo: () => { const i = useDocument.getState().actions.findIndex((x) => x.text === a.value); if (i !== -1) useDocument.getState().removeAction(i); } };
    }
    case "add_scratch_note": {
      const id = doc.addNote(a.value);
      return { ok: true, undo: () => useDocument.getState().removeNote(id) };
    }
    case "edit_item": case "remove_item": {
      const loc = locate(a, readChatDoc());
      if (!loc) return { ok: false, msg: "That item changed since this was proposed" };
      const edit = a.op === "edit_item";
      if (loc.type === "category") edit ? doc.renameCategory(loc.i, a.value) : doc.removeCategory(loc.i);
      else if (loc.type === "topic") edit ? doc.renameTopic(loc.ci, loc.ti, a.value) : doc.removeTopic(loc.ci, loc.ti);
      else edit ? doc.renameAction(loc.i, a.value) : doc.removeAction(loc.i);
      return { ok: true }; // confirmed edits use the document's own revert flow, not chat Undo
    }
    default:
      return { ok: false, msg: "Not available in this version yet" };
  }
}
