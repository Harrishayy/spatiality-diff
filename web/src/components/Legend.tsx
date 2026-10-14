"use client";
import { useSurvey } from "@/lib/store";

const toggles = [
  { k: "unobserved", sym: "unobs", label: "Not re-observed" },
  { k: "cameras", sym: "cams", label: "Camera paths" },
  { k: "stable", sym: "stable", label: "Room, shaded by height" },
] as const;

export default function Legend({ pushed }: { pushed: boolean }) {
  const layers = useSurvey((s) => s.layers), toggle = useSurvey((s) => s.toggleLayer);
  return (
    <div className={`absolute top-3.5 right-3.5 w-[208px] bg-surface border-[1.5px] border-ink px-3 pt-2.5 pb-2 transition-transform duration-[260ms] ${pushed ? "md:-translate-x-[calc(var(--sheet-w)+14px)] max-md:invisible" : ""}`} style={{ transitionTimingFunction: "var(--ease)" }}>
      <div className="label mb-1.5">Legend</div>
      {[["added", "Added, as it stands"], ["removed", "Removed, as it stood"], ["moved", "Moved, with dimension"]].map(([k, t], i) => (
        <div key={k} className={`flex items-center gap-2.5 text-[13px] py-[5px] ${i ? "border-t border-line" : ""}`}><span className={`sym ${k}`} />{t}</div>
      ))}
      {toggles.map((t) => (
        <label key={t.k} className="flex items-center gap-2.5 text-[13px] py-[5px] border-t border-line cursor-pointer">
          <input type="checkbox" id={`layer-${t.k}`} checked={layers[t.k]} onChange={() => toggle(t.k)} className="appearance-none w-3.5 h-3.5 border-[1.5px] border-ink rounded-[2px] m-0 flex-none relative checked:after:content-[''] checked:after:absolute checked:after:inset-[2px] checked:after:bg-ink" />
          <span className={`sym ${t.sym}`} />{t.label}
        </label>
      ))}
    </div>
  );
}
