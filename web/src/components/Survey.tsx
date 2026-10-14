"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { camPose } from "@/lib/geom";
import { loadCloud } from "@/lib/ply";
import { useSurvey } from "@/lib/store";
import type { CamerasPayload, ChangesPayload, Cloud, Finding } from "@/lib/types";
import FindingsStrip from "./FindingsStrip";
import Header from "./Header";
import Legend from "./Legend";
import Sheet from "./Sheet";
import TitleBlock from "./TitleBlock";

const Plan = dynamic(() => import("./Plan"), { ssr: false });
const Stage = dynamic(() => import("./Stage"), { ssr: false });

interface Loaded { clouds: { before: Cloud; after: Cloud; unobserved: Cloud }; blobs: Record<string, Cloud> }

export default function Survey({ scene, changes, cameras }: { scene: string; changes: ChangesPayload; cameras: CamerasPayload }) {
  const findings = useMemo<Finding[]>(() => changes.changes.map((c, i) => ({ ...c, n: i + 1 })), [changes]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copy changes.json");
  const view = useSurvey((s) => s.view), selected = useSurvey((s) => s.selected);
  const { select, setView, setBase, startReview, endReview, stepReview, mark, loadStatus, toggleLayer } = useSurvey.getState();

  useEffect(() => { loadStatus(scene); }, [scene, loadStatus]);
  useEffect(() => {
    let dead = false; const base = `/api/scenes/${scene}`;
    (async () => {
      try {
        const [before, after, unobserved] = await Promise.all([loadCloud(`${base}/before.ply`), loadCloud(`${base}/after.ply`), loadCloud(`${base}/before_unobserved.ply`).catch(() => ({ pos: new Float32Array(), rgb: new Float32Array(), n: 0 }))]);
        const plys = findings.flatMap((f) => [f.before?.ply, f.after?.ply]).filter((p): p is string => !!p);
        const blobs: Record<string, Cloud> = {};
        await Promise.all(plys.map(async (p) => { try { blobs[p] = await loadCloud(`${base}/${p}`); } catch {} }));
        if (!dead) setLoaded({ clouds: { before, after, unobserved }, blobs });
      } catch (e) { if (!dead) setErr(String(e)); }
    })();
    return () => { dead = true; };
  }, [scene, findings]);

  const onTip = useCallback((id: string | null, x: number, y: number) => setTip(id ? { id, x, y } : null), []);
  const onCopy = async () => { try { await navigator.clipboard.writeText(JSON.stringify({ ...changes, review: useSurvey.getState().status }, null, 1)); setCopyLabel("Copied"); } catch { setCopyLabel("Copy failed"); } setTimeout(() => setCopyLabel("Copy changes.json"), 1600); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
      const s = useSurvey.getState(); const ids = findings.map((f) => f.id), i = ids.indexOf(s.selected ?? "");
      if (e.key === "Escape") { endReview(); select(null); }
      else if (e.key === "a" && s.selected) { mark(s.selected, "accepted"); if (s.review) stepReview(1); }
      else if (e.key === "r" && s.selected) { mark(s.selected, "rejected"); if (s.review) stepReview(1); }
      else if (e.key === "p") setView("plan"); else if (e.key === "d") setView("3d"); else if (e.key === "b") setBase(s.base === "after" ? "before" : "after");
      else if (e.key === "u") toggleLayer("unobserved"); else if (e.key === "c") toggleLayer("cameras");
      else if (e.key === "ArrowRight" || e.key === "j") { select(ids[Math.min(ids.length - 1, i + 1)] ?? null); e.preventDefault(); }
      else if (e.key === "ArrowLeft" || e.key === "k") { select(ids[Math.max(0, i - 1)] ?? null); e.preventDefault(); }
      else if (/^[1-9]$/.test(e.key) && ids[+e.key - 1]) select(ids[+e.key - 1]);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [findings, select, setView, setBase, endReview, stepReview, mark, toggleLayer]);

  const planData = useMemo(() => loaded && { clouds: loaded.clouds, cams: { before: cameras.before.map(camPose), after: cameras.after.map(camPose) }, findings }, [loaded, cameras, findings]);
  const stageData = useMemo(() => loaded && { clouds: loaded.clouds, blobs: loaded.blobs, cameras, findings }, [loaded, cameras, findings]);
  const tipF = tip && findings.find((f) => f.id === tip.id);
  const pushed = !!selected;

  return (
    <div className="h-screen grid grid-rows-[auto_minmax(0,1fr)_auto]">
      <Header data={changes} onReview={() => startReview(findings.map((f) => f.id))} onCopy={onCopy} copyLabel={copyLabel} />
      <section className="relative min-h-0 overflow-hidden" aria-label="Survey drawing">
        {!loaded && !err && <div className="absolute inset-0 flex items-center justify-center text-ink-2 text-[13px]">Loading the sheet&hellip;</div>}
        {err && <div className="absolute inset-0 flex items-center justify-center text-removed text-[13px]">Could not load the scene files: {err}</div>}
        {planData && view === "plan" && <div className="absolute inset-0"><Plan data={planData} onTip={onTip} /></div>}
        {stageData && view === "3d" && <Stage data={stageData} onTip={onTip} />}
        <Legend pushed={pushed} />
        <TitleBlock data={changes} cameras={cameras} pushed={pushed} />
        {tipF && <div className="absolute pointer-events-none bg-ink text-on-ink px-[9px] py-[5px] text-[13px] rounded-[3px] max-w-[280px]" style={{ left: tip!.x + 14, top: tip!.y + 14 }}><b className="font-cond mr-1">{tipF.n}</b>{tipF.sentence}</div>}
        <Sheet scene={scene} findings={findings} />
      </section>
      <FindingsStrip findings={findings} />
    </div>
  );
}
