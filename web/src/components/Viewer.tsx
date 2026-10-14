"use client";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useViewer } from "@/lib/store";
import type { CamerasPayload, ChangesPayload } from "@/lib/types";
import ChangeList from "./ChangeList";
import ChangeSummary from "./ChangeSummary";
import EvidencePair from "./EvidencePair";
import Legend3D from "./Legend3D";
import ViewToggle from "./ViewToggle";

const SceneCanvas = dynamic(() => import("./SceneCanvas"), { ssr: false });

export default function Viewer({ scene, changes, cameras }: { scene: string; changes: ChangesPayload; cameras: CamerasPayload }) {
  const selected = useViewer((s) => s.selected);
  const select = useViewer((s) => s.select);
  const setView = useViewer((s) => s.setView);
  const toggle = useViewer((s) => s.toggle);
  const current = changes.changes.find((c) => c.id === selected);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const views = { "1": "before", "2": "after", "3": "diff", "4": "overlay" } as const;
      if (e.key in views) setView(views[e.key as keyof typeof views]);
      else if (e.key === "u") toggle("unobserved");
      else if (e.key === "g") toggle("removed");
      else if (e.key === "Escape") select(null);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const ids = changes.changes.map((c) => c.id);
        const i = ids.indexOf(selected ?? "");
        const n = e.key === "ArrowDown" ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1);
        select(ids[n] ?? null);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changes, selected, select, setView, toggle]);

  return (
    <div className="h-screen flex flex-col">
      <ChangeSummary data={changes} />
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[2fr_1fr] min-h-0">
        <div className="relative min-h-[50vh] md:min-h-0 bg-surface-0">
          <SceneCanvas scene={scene} data={changes} cameras={cameras} />
          <Legend3D />
          <div className="absolute right-3 top-3"><ViewToggle /></div>
          {current && (
            <div className="absolute left-3 right-3 bottom-3 max-w-[720px]">
              <EvidencePair scene={scene} change={current} />
            </div>
          )}
        </div>
        <aside className="border-l border-line bg-surface-1 overflow-y-auto min-h-0">
          <div className="px-4 py-3 border-b border-line">
            <div className="label text-ink-muted">Summary</div>
            <p className="text-sm mt-1">{changes.summary}</p>
          </div>
          <ChangeList scene={scene} changes={changes.changes} />
        </aside>
      </div>
    </div>
  );
}
