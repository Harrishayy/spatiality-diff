import { create } from "zustand";
import type { ViewMode } from "./types";

interface ViewerState {
  selected: string | null;
  view: ViewMode;
  visible: { added: boolean; removed: boolean; moved: boolean; unobserved: boolean; stable: boolean; cameras: boolean };
  select: (id: string | null) => void;
  setView: (v: ViewMode) => void;
  toggle: (k: keyof ViewerState["visible"]) => void;
}

export const useViewer = create<ViewerState>((set) => ({
  selected: null,
  view: "diff",
  visible: { added: true, removed: true, moved: true, unobserved: true, stable: true, cameras: true },
  select: (id) => set({ selected: id }),
  setView: (view) => set({ view }),
  toggle: (k) => set((s) => ({ visible: { ...s.visible, [k]: !s.visible[k] } })),
}));
