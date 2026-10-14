import type { ChangeState } from "@/lib/types";

const GLYPH: Record<ChangeState | "unobserved" | "warning", string> = { added: "+", removed: "−", moved: "→", unobserved: "?", warning: "!" };
const CLS: Record<ChangeState | "unobserved" | "warning", string> = {
  added: "bg-added text-on-added",
  removed: "bg-removed text-on-removed",
  moved: "bg-moved text-on-moved",
  unobserved: "hatch text-ink border border-unobserved",
  warning: "bg-warning text-on-accent",
};

export default function ChangeTag({ state, children }: { state: ChangeState | "unobserved" | "warning"; children?: React.ReactNode }) {
  return (
    <span className={`label inline-flex items-center gap-1 px-2 py-[2px] rounded-[var(--radius-pill)] ${CLS[state]}`}>
      <span className="font-mono text-[12px]">{GLYPH[state]}</span>
      {children ?? state}
    </span>
  );
}
