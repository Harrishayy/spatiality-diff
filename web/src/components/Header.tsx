"use client";
import { useSurvey } from "@/lib/store";
import type { ChangesPayload } from "@/lib/types";

export default function Header({ data, onReview, onCopy, copyLabel }: { data: ChangesPayload; onReview: () => void; onCopy: () => void; copyLabel: string }) {
  const view = useSurvey((s) => s.view), base = useSurvey((s) => s.base), setView = useSurvey((s) => s.setView), setBase = useSurvey((s) => s.setBase);
  const n = data.changes.length;
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3 border-b-[1.5px] border-ink bg-paper">
      <div>
        <div className="flex items-baseline gap-3">
          <b className="font-cond text-[13px] font-bold tracking-[.18em] uppercase">Spatiality Diff</b>
          <span className="font-cond text-[13px] font-medium tracking-[.06em] text-ink-2">Change survey &middot; sheet 1 of 1</span>
        </div>
        <h1 className="text-[22px] leading-[1.2] font-semibold tracking-[-.01em] mt-1.5">
          {n} finding{n === 1 ? "" : "s"} on {data.scene}. {Math.round(data.coverage * 100)}% of the before scene re-observed.
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === "plan"} onClick={() => setView("plan")}>Plan <kbd>p</kbd></button>
          <button aria-pressed={view === "3d"} onClick={() => setView("3d")}>3D <kbd>d</kbd></button>
        </div>
        <div className="seg" role="group" aria-label="Base capture">
          <button aria-pressed={base === "before"} onClick={() => setBase("before")}>Before</button>
          <button aria-pressed={base === "after"} onClick={() => setBase("after")}>After <kbd>b</kbd></button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn ghost" onClick={onCopy}>{copyLabel}</button>
        <button className="btn primary" onClick={onReview}>Start review <kbd>a</kbd><kbd>r</kbd></button>
      </div>
    </header>
  );
}
