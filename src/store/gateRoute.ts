import { create } from "zustand";
import type { ContextItem } from "@/lib/chat/types";

/**
 * Where a typed message or an attached file goes while the prompt clarity gate is open
 * (legacy `promptGate`, 10427). Kept apart from the chat and gate stores so the chat store can read
 * it without importing the gate (which imports the chat store).
 *
 *   null            no gate: messages go to the normal chat turn
 *   {}              the gate is mid-check: a message has nowhere to go yet, so the composer is held
 *   { onText, ... } Chat asked a question: a typed message is the answer, not a chat turn
 */
export interface GateRoute {
  onText?: (text: string) => void;
  onFiles?: (items: ContextItem[]) => void;
}

interface GateRouteState {
  route: GateRoute | null;
  setRoute: (route: GateRoute | null) => void;
}

export const useGateRoute = create<GateRouteState>((set) => ({
  route: null,
  setRoute: (route) => set({ route }),
}));

/** True while the gate is checking and the person has nothing to answer yet. */
export const selectGateHeld = (s: GateRouteState): boolean => !!s.route && !s.route.onText;
