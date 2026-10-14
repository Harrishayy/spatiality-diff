"use client";
import { useSurvey } from "@/lib/store";
import { GLYPH, WORD, type Finding } from "@/lib/types";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const fid = (s: string) => s.replace(/^0+(?=\d)/, "");
const why = (f: Finding) => { const b = f.before!, a = f.after!;
  if (f.state === "moved") return `The old footprint was seen empty from ${b.support.free} of ${b.support.looked} after frames that looked there, and the new footprint has no match in the before scene. Same size and colour, so one object.`;
  if (f.state === "removed") return `${b.support.free} of ${b.support.looked} after frames that looked at this spot saw free space where the ${f.label} stood.`;
  return `${a.support.free} of ${a.support.looked} before frames that looked at this spot saw free space where the ${f.label} now stands.`; };

export default function Sheet({ scene, findings }: { scene: string; findings: Finding[] }) {
  const selected = useSurvey((s) => s.selected), review = useSurvey((s) => s.review), status = useSurvey((s) => s.status);
  const mark = useSurvey((s) => s.mark), stepReview = useSurvey((s) => s.stepReview), endReview = useSurvey((s) => s.endReview), select = useSurvey((s) => s.select);
  const f = findings.find((x) => x.id === selected);
  const open = !!f;
  const verdict = (v: "accepted" | "rejected") => { if (!f) return; mark(f.id, v); if (review) stepReview(1); };
  const b = f ? (f.after ?? f.before)! : null;
  const side = (w: "before" | "after") => { if (!f) return null; const e = f.evidence[w];
    const note = f.state === "moved" ? (w === "before" ? "Old pose" : "New pose") : f.state === "removed" ? (w === "after" ? "Free space now" : "As it stood") : w === "before" ? "Free space then" : "As it stands";
    return (<figure className="m-0 min-w-0">
      <div className="aspect-[4/3] max-w-full border-[1.5px] border-ink bg-paper flex items-center justify-center overflow-hidden text-ink-3 text-[13px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {e ? <img src={`/api/scenes/${scene}/${e.crop}`} alt={`${w} frame ${e.frame_id}`} className="w-full h-full object-contain block" /> : <span>Not observed</span>}
      </div>
      <figcaption className="flex justify-between gap-2 mt-[5px] font-cond text-[12px] font-medium tracking-[.03em] text-ink-2"><span>{cap(w)}, frame {e ? fid(e.frame_id) : "—"}</span><span>{note}</span></figcaption>
    </figure>); };
  const rows: [string, string][] = f && b ? [
    ["Finding", `${f.n} of ${findings.length}`], ["Type", WORD[f.state]], ["Object", cap(f.label)],
    ...(f.displacement_m != null ? [["Displacement", `${f.displacement_m.toFixed(2)} m`] as [string, string]] : []),
    ["Footprint", `${b.obb.extent[0].toFixed(2)} × ${b.obb.extent[1].toFixed(2)} m`], ["Height", `${b.obb.extent[2].toFixed(2)} m`],
    ["Centroid", b.centroid.map((v) => v.toFixed(2)).join(", ")], ["Support", `${b.support.free} of ${b.support.looked} frames`], ["Confidence", f.confidence.toFixed(2)],
  ] : [];
  const st = f ? status[f.id] : undefined;
  return (
    <aside aria-label="Finding detail" aria-hidden={!open} className={`absolute top-0 right-0 bottom-0 w-[var(--sheet-w)] max-w-full bg-surface border-l-[1.5px] border-ink px-5 pt-[18px] pb-6 overflow-y-auto transition-transform duration-[260ms] ${open ? "translate-x-0 visible" : "translate-x-full invisible"}`} style={{ transitionTimingFunction: "var(--ease)" }}>
      {f && b && (<>
        <div className="flex justify-between gap-3 items-start mb-3">
          <div><div className="label">{review ? `Review ${review.i + 1} of ${review.ids.length}` : `Finding ${f.n}`}</div><h2 className="text-[19px] leading-[1.25] font-semibold tracking-[-.01em] text-balance">{f.sentence}</h2></div>
          <button className="w-8 h-8 inline-flex items-center justify-center border-[1.5px] border-line-strong rounded-[4px] text-ink-2 hover:text-ink flex-none" aria-label="Close" onClick={() => (review ? endReview() : select(null))}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <span className={`chip text-${f.state}`}><span className="g">{GLYPH[f.state]}</span>{WORD[f.state]}</span>
          {f.confidence < 0.6 && <span className="chip text-removed border-dashed">! Low support</span>}
        </div>
        <p className="my-3 text-ink-2 text-[14px] leading-[1.5] text-pretty">{why(f)}</p>
        <div className="grid grid-cols-2 gap-2.5">{side("before")}{side("after")}</div>
        <h3 className="label mt-[18px] mb-1.5">Measurements</h3>
        <table className="w-full border-collapse text-[13px]"><tbody>{rows.map(([k, v]) => (<tr key={k}><th className="text-left font-medium text-ink-2 py-[5px] border-b border-line w-[42%]">{k}</th><td className="font-mono text-[12.5px] py-[5px] border-b border-line">{v}</td></tr>))}</tbody></table>
        <div className="flex gap-2 mt-[18px] flex-wrap">
          <button className={`btn ${st === "accepted" ? "on-ok" : ""}`} onClick={() => verdict("accepted")}>&#10003; Accept <kbd>a</kbd></button>
          <button className={`btn ${st === "rejected" ? "on-no" : ""}`} onClick={() => verdict("rejected")}>&#10005; Reject <kbd>r</kbd></button>
          {st && <button className="btn ghost" onClick={() => mark(f.id, null)}>Clear</button>}
        </div>
        {review && (<div className="flex justify-between mt-2.5">
          <button className="btn ghost" disabled={review.i === 0} onClick={() => stepReview(-1)}>&larr; Previous</button>
          <button className="btn ghost" onClick={() => stepReview(1)}>{review.i + 1 < review.ids.length ? "Skip →" : "Finish"}</button>
        </div>)}
      </>)}
    </aside>
  );
}
