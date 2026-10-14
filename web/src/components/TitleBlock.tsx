import type { CamerasPayload, ChangesPayload } from "@/lib/types";

export default function TitleBlock({ data, cameras, pushed }: { data: ChangesPayload; cameras: CamerasPayload; pushed: boolean }) {
  const p = data.pipeline as Record<string, unknown>;
  const rows: [string, string][] = [
    ["Project", data.scene], ["Sheet", "Change survey, plan"],
    ["Frames", `${cameras.before.length} before · ${cameras.after.length} after`],
    ["Coverage", `${data.coverage.toFixed(2)} of before scene`],
    ["Units", data.units === "m" ? "metres" : "model units (≈ m)"],
    ["Method", `${String(p.backend ?? "joint recon")} · visibility diff`],
    ["Rev", `A · ${new Date().toISOString().slice(0, 10)}`],
  ];
  return (
    <div className={`absolute right-3.5 bottom-3.5 bg-surface border-[1.5px] border-ink text-[12px] transition-transform duration-[260ms] max-md:hidden ${pushed ? "-translate-x-[calc(var(--sheet-w)+14px)]" : ""}`} style={{ transitionTimingFunction: "var(--ease)" }} aria-label="Title block">
      <table className="border-collapse">
        <tbody>{rows.map(([k, v], i) => (
          <tr key={k}><th className={`text-left font-cond text-[11px] font-semibold tracking-[.08em] uppercase text-ink-2 px-2.5 py-1 border-r border-line whitespace-nowrap ${i < rows.length - 1 ? "border-b border-line" : ""}`}>{k}</th><td className={`font-mono px-2.5 py-1 whitespace-nowrap ${i < rows.length - 1 ? "border-b border-line" : ""}`}>{v}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
