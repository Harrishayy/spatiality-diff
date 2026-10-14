"use client";
import { useEffect, useRef } from "react";
import { useViewer } from "@/lib/store";
import type { ChangeJson } from "@/lib/types";
import ChangeTag from "./ChangeTag";

const THRESHOLD = 0.6;

function Row({ scene, c }: { scene: string; c: ChangeJson }) {
  const selected = useViewer((s) => s.selected === c.id);
  const select = useViewer((s) => s.select);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const blob = c.after ?? c.before;
  const low = c.confidence < THRESHOLD;
  const metric =
    c.state === "moved" && c.displacement_m != null
      ? `Δ ${c.displacement_m.toFixed(2)} m`
      : c.state === "added" && blob
        ? blob.obb.extent.map((e) => e.toFixed(2)).join(" × ") + " m"
        : blob
          ? `free space confirmed from ${blob.support.free} viewpoints`
          : "";
  return (
    <button
      ref={ref}
      onClick={() => select(selected ? null : c.id)}
      aria-pressed={selected}
      className={`relative text-left grid grid-cols-[1fr_96px] gap-3 px-4 py-3 border-b border-line last:border-b-0 hover:bg-surface-2 ${selected ? "bg-surface-2" : ""}`}
    >
      {selected && <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" />}
      <div className="min-w-0">
        <div className="flex gap-2 items-center">
          <ChangeTag state={c.state} />
          {low && <ChangeTag state="warning">Low support</ChangeTag>}
        </div>
        <h3 className={`mt-1 text-[15px] leading-5 font-semibold ${selected ? "text-accent" : ""}`}>{c.sentence}</h3>
        <div className="data text-ink-muted mt-[2px] truncate">
          {metric} {c.evidence.before && <>· before {c.evidence.before.frame_id}</>} {c.evidence.after && <>→ after {c.evidence.after.frame_id}</>}
        </div>
        <div className="data mt-[6px] flex items-center gap-2">
          <span className="inline-block w-[120px] h-1 border border-line rounded-[var(--radius-xs)] bg-surface-2 overflow-hidden">
            <span className={`block h-full ${low ? "bg-warning" : "bg-ink"}`} style={{ width: `${Math.round(c.confidence * 100)}%` }} />
          </span>
          <span className={low ? "text-warning" : ""}>conf {c.confidence.toFixed(2)}</span>
          {blob && <span className="text-ink-muted">{blob.support.free} / {blob.support.looked}</span>}
        </div>
        {low && <p className="text-[13px] text-ink-muted mt-1">Seen from too few viewpoints. Capture more of this area to confirm.</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["before", "after"] as const).map((w) => {
          const ev = c.evidence[w];
          return (
            <div key={w} className="aspect-square rounded-[var(--radius-xs)] bg-surface-2 border border-line overflow-hidden relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {ev && <img src={`/api/scenes/${scene}/${ev.crop}`} alt="" className="w-full h-full object-cover" />}
              <small className="absolute left-[3px] bottom-[2px] font-mono text-[9px] text-ink-muted bg-surface-1/80 px-[2px]">{w} {ev?.frame_id ?? "—"}</small>
            </div>
          );
        })}
      </div>
    </button>
  );
}

export default function ChangeList({ scene, changes }: { scene: string; changes: ChangeJson[] }) {
  const high = changes.filter((c) => c.confidence >= THRESHOLD);
  const low = changes.filter((c) => c.confidence < THRESHOLD);
  return (
    <div className="flex flex-col">
      {high.map((c) => <Row key={c.id} scene={scene} c={c} />)}
      {low.length > 0 && (
        <>
          <div className="label text-ink-muted px-4 py-2 border-y border-line bg-surface-1">Needs more capture</div>
          {low.map((c) => <Row key={c.id} scene={scene} c={c} />)}
        </>
      )}
      {changes.length === 0 && <div className="p-4 text-ink-muted text-sm">No changes above threshold.</div>}
    </div>
  );
}
