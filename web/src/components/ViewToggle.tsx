"use client";
import { useViewer } from "@/lib/store";
import type { ViewMode } from "@/lib/types";

const MODES: { id: ViewMode; key: string }[] = [
  { id: "before", key: "1" },
  { id: "after", key: "2" },
  { id: "diff", key: "3" },
  { id: "overlay", key: "4" },
];

export default function ViewToggle() {
  const view = useViewer((s) => s.view);
  const setView = useViewer((s) => s.setView);
  return (
    <div role="group" aria-label="View" className="inline-flex gap-[2px] p-[2px] border border-line-strong rounded-[var(--radius-pill)] bg-surface-2">
      {MODES.map((m) => (
        <button
          key={m.id}
          aria-pressed={view === m.id}
          onClick={() => setView(m.id)}
          className={`px-3 py-1 rounded-[var(--radius-pill)] text-[13px] font-medium capitalize ${view === m.id ? "bg-ink text-surface-1" : "text-ink-muted hover:text-ink"}`}
        >
          {m.id}
          <kbd className="font-mono text-[11px] ml-[6px] opacity-70">{m.key}</kbd>
        </button>
      ))}
    </div>
  );
}
