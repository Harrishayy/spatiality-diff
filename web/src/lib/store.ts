import { create } from "zustand";
import type { Base, Verdict, View } from "./types";

interface Review { ids: string[]; i: number }
interface S {
  selected: string | null; hover: string | null; view: View; base: Base; review: Review | null;
  layers: { unobserved: boolean; cameras: boolean; stable: boolean };
  status: Record<string, Verdict>;
  select: (id: string | null) => void; setHover: (id: string | null) => void; setView: (v: View) => void; setBase: (b: Base) => void;
  toggleLayer: (k: "unobserved" | "cameras" | "stable") => void;
  mark: (id: string, v: Verdict | null) => void; startReview: (ids: string[]) => void; stepReview: (d: number) => void; endReview: () => void;
  loadStatus: (scene: string) => void;
}
let sceneKey = "";
const persist = (status: Record<string, Verdict>) => { try { localStorage.setItem(`sd.status.${sceneKey}`, JSON.stringify(status)); } catch {} };

export const useSurvey = create<S>((set, get) => ({
  selected: null, hover: null, view: "plan", base: "after", review: null,
  layers: { unobserved: true, cameras: true, stable: true }, status: {},
  select: (selected) => set({ selected }),
  setHover: (hover) => set({ hover }),
  setView: (view) => set({ view }),
  setBase: (base) => set({ base }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  mark: (id, v) => { const status = { ...get().status }; if (v) status[id] = v; else delete status[id]; persist(status); set({ status }); },
  startReview: (ids) => set({ review: { ids, i: 0 }, selected: ids[0] ?? null }),
  stepReview: (d) => { const r = get().review; if (!r) return; const i = r.i + d; if (i < 0) return; if (i >= r.ids.length) { set({ review: null, selected: null }); return; } set({ review: { ...r, i }, selected: r.ids[i] }); },
  endReview: () => set({ review: null, selected: null }),
  loadStatus: (scene) => { sceneKey = scene; try { set({ status: JSON.parse(localStorage.getItem(`sd.status.${scene}`) || "{}") }); } catch { set({ status: {} }); } },
}));
