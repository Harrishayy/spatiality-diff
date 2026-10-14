import type { ChangeJson } from "@/lib/types";

export default function EvidencePair({ scene, change }: { scene: string; change: ChangeJson }) {
  const side = (which: "before" | "after") => {
    const ev = change.evidence[which];
    return (
      <div className="min-w-0">
        <div className="label text-ink-muted">{which}</div>
        <div className="mt-1 aspect-[4/3] bg-surface-2 border border-line rounded-[var(--radius-xs)] overflow-hidden">
          {ev ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/scenes/${scene}/${ev.crop}`} alt={`${which} frame ${ev.frame_id}`} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-faint text-sm">not observed</div>
          )}
        </div>
        <div className="data flex justify-between mt-2">
          <span>{which} {ev?.frame_id ?? "—"}</span>
          <span className="text-ink-muted">
            {which === "before" && change.state === "moved" ? "old pose" : which === "after" && change.displacement_m != null ? `Δ ${change.displacement_m.toFixed(2)} m` : ""}
          </span>
        </div>
      </div>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-3 p-4 bg-surface-1 border border-line rounded-[var(--radius-md)]">
      {side("before")}
      {side("after")}
    </div>
  );
}
