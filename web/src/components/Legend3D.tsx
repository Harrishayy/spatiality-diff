"use client";
import { useViewer } from "@/lib/store";

const ROWS = [
  { k: "added", glyph: "+", sw: "bg-added" },
  { k: "removed", glyph: "−", sw: "bg-removed opacity-60 outline outline-2 -outline-offset-2 outline-removed" },
  { k: "moved", glyph: "→", sw: "bg-moved" },
  { k: "unobserved", glyph: "?", sw: "hatch border border-unobserved" },
  { k: "stable", glyph: "·", sw: "bg-ink-faint" },
  { k: "cameras", glyph: "▲", sw: "border border-ink-faint" },
] as const;

export default function Legend3D() {
  const visible = useViewer((s) => s.visible);
  const toggle = useViewer((s) => s.toggle);
  return (
    <div className="absolute left-3 top-3 flex flex-col gap-[6px] p-3 bg-surface-1 border border-line rounded-[var(--radius-md)]">
      {ROWS.map((r) => (
        <button key={r.k} onClick={() => toggle(r.k)} className={`label flex items-center gap-2 ${visible[r.k] ? "" : "opacity-45"}`} aria-pressed={visible[r.k]}>
          <span className={`w-[14px] h-[14px] rounded-[var(--radius-xs)] ${r.sw}`} />
          <span className="font-mono w-[10px] text-ink-muted">{r.glyph}</span>
          {r.k}
        </button>
      ))}
    </div>
  );
}
