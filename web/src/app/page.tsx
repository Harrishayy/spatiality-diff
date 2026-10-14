import Link from "next/link";
import { listScenes } from "@/lib/scenes";

export const dynamic = "force-dynamic";

export default async function Home() {
  const scenes = await listScenes();
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12 flex flex-col gap-6">
      <div>
        <div className="flex items-baseline gap-3"><b className="font-cond text-[13px] font-bold tracking-[.18em] uppercase">Spatiality Diff</b><span className="font-cond text-[13px] font-medium tracking-[.06em] text-ink-2">Change surveys</span></div>
        <h1 className="text-[28px] leading-[1.2] font-semibold tracking-[-.01em] mt-2">What changed in the room?</h1>
        <p className="text-ink-2 mt-2 max-w-[60ch]">Two phone captures, one shared 3D scene, and every added, removed or moved object drawn on a plan with the frames that prove it.</p>
      </div>
      <section className="border-[1.5px] border-ink bg-surface">
        <div className="px-4 py-2.5 border-b border-line label">Sheets in outputs/</div>
        {scenes.length === 0 ? (
          <div className="p-4 text-ink-2 text-[14px]">No sheets yet. Run <code className="font-mono text-[12.5px]">PYTHONPATH=tests python scripts/make_demo.py</code> for the synthetic room, or <code className="font-mono text-[12.5px]">spatiality-diff run --before a.mp4 --after b.mp4 --out outputs/my_room</code>.</div>
        ) : scenes.map((s) => (
          <Link key={s.id} href={`/scenes/${s.id}`} className="flex justify-between items-center px-4 py-3 border-b border-line last:border-b-0 hover:bg-paper">
            <span className="font-semibold">{s.id}</span><span className="font-mono text-[12px] text-ink-2">{new Date(s.mtime).toLocaleString()}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
