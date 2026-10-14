"use client";
import { useEffect, useRef } from "react";
import { useSurvey } from "@/lib/store";
import { GLYPH, WORD, type Finding } from "@/lib/types";

export const metric = (f: Finding) => { const b = (f.after ?? f.before)!; return f.state === "moved" && f.displacement_m != null ? `${f.displacement_m.toFixed(2)} m` : f.state === "added" ? `${b.obb.extent.map((e) => e.toFixed(2)).join(" × ")} m` : `${b.support.free} viewpoints saw it empty`; };

function Card({ f, i }: { f: Finding; i: number }) {
  const sel = useSurvey((s) => s.selected === f.id), st = useSurvey((s) => s.status[f.id]), select = useSurvey((s) => s.select);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (sel) ref.current?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, [sel]);
  return (
    <li className="flex-none w-[min(320px,84vw)] snap-start">
      <button ref={ref} onClick={() => select(sel ? null : f.id)} aria-pressed={sel} style={{ "--i": Math.min(i, 6) } as React.CSSProperties}
        className={`cardin w-full text-left grid grid-cols-[34px_minmax(0,1fr)] gap-2.5 p-3 bg-surface min-h-[92px] border-[1.5px] transition-[border-color,box-shadow] duration-120 hover:border-ink ${sel ? "border-ink shadow-[inset_0_0_0_1px_var(--ink),0_0_0_3px_var(--marker)]" : "border-line-strong"} ${st === "rejected" ? "opacity-60" : ""}`}>
        <span className={`bal ${sel ? "sel" : ""}`} style={sel ? { boxShadow: "none" } : undefined}>{f.n}</span>
        <span className="flex flex-col gap-1 min-w-0">
          <span className="flex gap-1.5 flex-wrap">
            <span className={`chip text-${f.state}`}><span className="g">{GLYPH[f.state]}</span>{WORD[f.state]}</span>
            {st && <span className={`chip ${st === "accepted" ? "text-ok" : "text-ink-2 border-line-strong"}`}>{st === "accepted" ? "✓ Accepted" : "✕ Rejected"}</span>}
          </span>
          <span className="font-semibold text-[15px] leading-[1.3] text-balance">{f.sentence}</span>
          <span className="font-mono text-[12.5px] text-ink-2">{metric(f)} &middot; confidence {f.confidence.toFixed(2)}</span>
        </span>
      </button>
    </li>
  );
}

export default function FindingsStrip({ findings }: { findings: Finding[] }) {
  const status = useSurvey((s) => s.status);
  const acc = findings.filter((f) => status[f.id] === "accepted").length, rej = findings.filter((f) => status[f.id] === "rejected").length;
  return (
    <footer className="border-t-[1.5px] border-ink bg-paper px-5 pt-2.5 pb-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="label">Findings</span>
        <span className="font-mono text-[12px] text-ink-2">{acc} accepted &middot; {rej} rejected &middot; {findings.length - acc - rej} open</span>
      </div>
      {findings.length ? (
        <ul className="flex gap-2.5 overflow-x-auto pb-1 snap-x snap-proximity">{findings.map((f, i) => <Card key={f.id} f={f} i={i} />)}</ul>
      ) : (
        <p className="text-[13px] text-ink-2">No findings. The re-observed part of the room is unchanged; hatched areas were not inspected.</p>
      )}
    </footer>
  );
}
