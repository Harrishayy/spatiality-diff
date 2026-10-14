import type { ChangesPayload } from "@/lib/types";

export default function ChangeSummary({ data }: { data: ChangesPayload }) {
  const cov = Math.round(data.coverage * 100);
  return (
    <div className="flex flex-wrap items-center gap-6 px-4 py-3 border-b border-line bg-surface-1">
      <div>
        <div className="label text-ink-muted">Scene</div>
        <h1 className="text-[20px] leading-[26px] font-semibold tracking-[-0.2px]">{data.scene}</h1>
      </div>
      {(["added", "removed", "moved"] as const).map((k) => (
        <div key={k} className="flex flex-col gap-[2px]">
          <span className="label text-ink-muted">{k}</span>
          <span className="font-mono text-[20px] leading-6 font-medium" style={{ color: `var(--${k})` }}>{data.counts[k]}</span>
        </div>
      ))}
      <div className="ml-auto flex flex-col gap-1 min-w-[200px]">
        <span className="label text-ink-muted">Coverage of before scene</span>
        <div className="h-[6px] border border-line rounded-[var(--radius-xs)] bg-surface-2 overflow-hidden relative">
          <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${cov}%` }} />
          <div className="absolute inset-y-0 right-0 hatch" style={{ width: `${100 - cov}%` }} />
        </div>
        <span className="data">
          {data.coverage.toFixed(2)} observed <span className="text-ink-muted">{(1 - data.coverage).toFixed(2)} unobserved</span>
        </span>
      </div>
    </div>
  );
}
