import Link from "next/link";
import { listScenes } from "@/lib/scenes";

export const dynamic = "force-dynamic";

export default async function Home() {
  const scenes = await listScenes();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 flex flex-col gap-6">
      <div>
        <p className="label text-ink-muted">Spatiality Diff</p>
        <h1 className="text-[40px] leading-[44px] font-semibold tracking-[-0.5px] mt-1">What changed in the room?</h1>
        <p className="text-ink-muted mt-3 max-w-[60ch]">
          Two phone captures of the same room, one shared 3D scene, and every added, removed or moved object with the frames that prove it.
        </p>
      </div>
      <section className="border border-line rounded-[var(--radius-md)] bg-surface-1">
        <div className="px-4 py-3 border-b border-line label text-ink-muted">Scenes in outputs/</div>
        {scenes.length === 0 ? (
          <div className="p-4 text-ink-muted text-sm">
            No scenes yet. Run <code className="data">python scripts/make_demo.py</code> for a synthetic room, or{" "}
            <code className="data">spatiality-diff run --before a.mp4 --after b.mp4 --out outputs/my_room</code>.
          </div>
        ) : (
          scenes.map((s) => (
            <Link key={s.id} href={`/scenes/${s.id}`} className="flex justify-between px-4 py-3 border-b border-line last:border-b-0 hover:bg-surface-2">
              <span className="font-medium">{s.id}</span>
              <span className="data text-ink-muted">{new Date(s.mtime).toLocaleString()}</span>
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
