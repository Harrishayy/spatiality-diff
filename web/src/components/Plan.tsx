"use client";
import { useEffect, useRef } from "react";
import { PlanRenderer, type PlanData } from "@/lib/plan";
import { useSurvey } from "@/lib/store";

export default function Plan({ data, onTip }: { data: PlanData; onTip: (id: string | null, x: number, y: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const R = useRef<PlanRenderer | null>(null);
  const select = useSurvey((s) => s.select), setHover = useSurvey((s) => s.setHover);

  useEffect(() => {
    const canvas = ref.current!; const r = new PlanRenderer(canvas, data); R.current = r; r.resize(); r.fit();
    const draw = () => r.draw(useSurvey.getState());
    draw();
    const unsub = useSurvey.subscribe((s, prev) => { draw(); if (s.selected && s.selected !== prev.selected && s.view === "plan") fly(r, s.selected, draw); });
    const ro = new ResizeObserver(() => { r.resize(); draw(); }); ro.observe(canvas.parentElement!);
    const mq = matchMedia("(prefers-color-scheme: dark)"); const retheme = () => { r.invalidate(); draw(); }; mq.addEventListener("change", retheme);
    const mo = new MutationObserver(retheme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const pos = (e: PointerEvent) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top] as const; };
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, moved: false }; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { const [px, py] = pos(e);
      if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true; r.view.ox += dx; r.view.oy += dy; drag.x = e.clientX; drag.y = e.clientY; draw(); return; }
      const id = r.hit(px, py); canvas.style.cursor = id ? "pointer" : "grab"; if (id !== useSurvey.getState().hover) setHover(id); onTip(id, px, py); };
    const up = (e: PointerEvent) => { if (drag && !drag.moved) { const [px, py] = pos(e); const id = r.hit(px, py); const cur = useSurvey.getState().selected; select(id === cur ? null : id); } drag = null; };
    const leave = () => { setHover(null); onTip(null, 0, 0); };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const [px, py] = pos(e as unknown as PointerEvent); const k = Math.exp(-e.deltaY * 0.0012); const v = r.view; const ns = Math.min(2000, Math.max(30, v.s * k)); const f = ns / v.s; v.ox = px - (px - v.ox) * f; v.oy = py - (py - v.oy) * f; v.s = ns; draw(); };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointerleave", leave); canvas.addEventListener("wheel", wheel, { passive: false });
    return () => { unsub(); ro.disconnect(); mq.removeEventListener("change", retheme); mo.disconnect(); canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointerleave", leave); canvas.removeEventListener("wheel", wheel); };
  }, [data, select, setHover, onTip]);

  return <canvas ref={ref} className="block cursor-grab touch-none" aria-label="Top-down plan of the room with numbered findings" />;
}

function fly(r: PlanRenderer, id: string, draw: () => void) {
  const [cx, cy] = r.centerOf(id); const v = r.view; const tx = v.w / 2 - cx * v.s, ty = v.h / 2 + cy * v.s;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { v.ox = tx; v.oy = ty; draw(); return; }
  const from = { ox: v.ox, oy: v.oy }, t0 = performance.now();
  const step = (now: number) => { const k = Math.min(1, (now - t0) / 380), e = 1 - Math.pow(1 - k, 3); v.ox = from.ox + (tx - from.ox) * e; v.oy = from.oy + (ty - from.oy) * e; draw(); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
