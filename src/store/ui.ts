import { create } from "zustand";

export type Theme = "light" | "dark";
export type LayoutMode = "2panel" | "3panel";
export type NodeKey = "entry" | "intent" | "planning" | "exec" | "result";
export type Screen = "home" | "node";

const THEME_KEY = "proto.theme";
const LAYOUT_KEY = "en2-layout";

const read = (k: string): string | null => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const write = (k: string, v: string) => {
  try { localStorage.setItem(k, v); } catch { /* private mode: the choice just isn't remembered */ }
};

interface UiState {
  theme: Theme;
  layout: LayoutMode;
  screen: Screen;
  activeNode: NodeKey;
  /** The prompt that started the current node (the Entry node's originating prompt). */
  prompt: string;
  /** Set after hydration so first paint matches the server render. */
  hydrated: boolean;

  hydrate: () => () => void;
  toggleTheme: () => void;
  setLayout: (m: LayoutMode) => void;
  goHome: () => void;
  backToNode: () => void;
  startNode: (prompt: string) => void;
  setActiveNode: (n: NodeKey) => void;
}

export const useUi = create<UiState>((set, get) => ({
  theme: "light",
  layout: "3panel",
  screen: "home",
  activeNode: "entry",
  prompt: "",
  hydrated: false,

  /**
   * Reads what the pre-paint script and localStorage decided, and follows the OS theme live
   * while the user has not chosen one. Returns the cleanup function.
   */
  hydrate: () => {
    const root = document.documentElement;
    const attr = root.getAttribute("data-theme");
    set({
      theme: attr === "dark" ? "dark" : "light",
      layout: read(LAYOUT_KEY) === "2panel" ? "2panel" : "3panel",
      hydrated: true,
    });
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const onChange = (e: MediaQueryListEvent) => {
      if (read(THEME_KEY)) return; // an explicit choice wins
      const next: Theme = e.matches ? "dark" : "light";
      root.setAttribute("data-theme", next);
      set({ theme: next });
    };
    mq?.addEventListener("change", onChange);
    return () => mq?.removeEventListener("change", onChange);
  },

  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    write(THEME_KEY, next);
    set({ theme: next });
  },

  setLayout: (layout) => {
    write(LAYOUT_KEY, layout);
    set({ layout });
  },

  goHome: () => set({ screen: "home" }),
  backToNode: () => set({ screen: "node" }),
  startNode: (prompt) => set({ prompt: prompt.trim(), screen: "node", activeNode: "entry" }),
  setActiveNode: (activeNode) => set({ activeNode }),
}));
