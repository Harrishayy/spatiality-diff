"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useSurvey } from "@/lib/store";
import type { BlobJson, CamerasPayload, Cloud, Finding } from "@/lib/types";

export interface StageData { clouds: { before: Cloud; after: Cloud; unobserved: Cloud }; blobs: Record<string, Cloud>; cameras: CamerasPayload; findings: Finding[] }
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const W2T = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const obbM = (b: BlobJson) => { const R = b.obb.rotation, c = b.obb.center; return new THREE.Matrix4().set(R[0][0], R[0][1], R[0][2], c[0], R[1][0], R[1][1], R[1][2], c[1], R[2][0], R[2][1], R[2][2], c[2], 0, 0, 0, 1); };
const mkPts = (d: Cloud, o: Partial<THREE.PointsMaterialParameters>) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(d.pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(d.rgb, 3)); return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.012, ...o })); };
function frustum(K: number[][], E: number[][], size = 0.11) { const M = new THREE.Matrix4().set(E[0][0], E[0][1], E[0][2], E[0][3], E[1][0], E[1][1], E[1][2], E[1][3], E[2][0], E[2][1], E[2][2], E[2][3], 0, 0, 0, 1).invert();
  const fx = K[0][0], fy = K[1][1], cx = K[0][2], cy = K[1][2]; const c = [[0, 0], [2 * cx, 0], [2 * cx, 2 * cy], [0, 2 * cy]].map(([u, v]) => new THREE.Vector3(((u - cx) / fx) * size, ((v - cy) / fy) * size, size)); const o = new THREE.Vector3(), pts: THREE.Vector3[] = []; for (let i = 0; i < 4; i++) pts.push(o, c[i], c[i], c[(i + 1) % 4]);
  const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 })); l.applyMatrix4(M); return l; }

export default function Stage({ data, onTip }: { data: StageData; onTip: (id: string | null, x: number, y: number) => void }) {
  const mount = useRef<HTMLDivElement>(null); const balRef = useRef<HTMLDivElement>(null);
  const select = useSurvey((s) => s.select);
  useEffect(() => {
    const el = mount.current!; const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); el.prepend(renderer.domElement);
    const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100); const root = new THREE.Group(); root.rotation.x = -Math.PI / 2; scene.add(root);
    const grid = new THREE.GridHelper(6, 12, 0x000000, 0x000000); grid.position.y = -0.005; scene.add(grid);
    const ctl = { target: new THREE.Vector3(0, 0.5, 0.2), theta: 0.9, phi: 1.1, dist: 4.4 };
    const G = { before: mkPts(data.clouds.before, { vertexColors: true, transparent: true }), after: mkPts(data.clouds.after, { vertexColors: true, transparent: true }), unobs: mkPts(data.clouds.unobserved, { size: 0.02, transparent: true, opacity: 0.7 }) };
    Object.values(G).forEach((p) => root.add(p));
    const camG = new THREE.Group(); root.add(camG); const camLines = { before: [] as THREE.LineSegments[], after: [] as THREE.LineSegments[] };
    data.cameras.before.forEach((c) => { const f = frustum(c.K, c.cam_from_world); camG.add(f); camLines.before.push(f); }); data.cameras.after.forEach((c) => { const f = frustum(c.K, c.cam_from_world); camG.add(f); camLines.after.push(f); });
    const per = new Map<string, { lines: THREE.LineSegments[]; points: THREE.Points[]; arrow?: THREE.ArrowHelper; bal: HTMLButtonElement }>(); const pickables: THREE.Mesh[] = [];
    for (const f of data.findings) { const g = new THREE.Group(); root.add(g); const own = { lines: [] as THREE.LineSegments[], points: [] as THREE.Points[], arrow: undefined as THREE.ArrowHelper | undefined, bal: document.createElement("button") };
      const box = (b: BlobJson, tone: string) => { const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...b.obb.extent)), new THREE.LineBasicMaterial()); e.applyMatrix4(obbM(b)); e.userData.tone = tone; g.add(e); own.lines.push(e); const h = new THREE.Mesh(new THREE.BoxGeometry(...b.obb.extent), new THREE.MeshBasicMaterial({ visible: false })); h.applyMatrix4(obbM(b)); h.userData.id = f.id; g.add(h); pickables.push(h); };
      if (f.before && data.blobs[f.before.ply]) { const p = mkPts(data.blobs[f.before.ply], { size: 0.016, transparent: true, opacity: f.state === "moved" ? 0.35 : 0.6 }); p.userData.tone = "removed"; g.add(p); own.points.push(p); box(f.before, "removed"); }
      if (f.after && data.blobs[f.after.ply]) { const p = mkPts(data.blobs[f.after.ply], { size: 0.016 }); p.userData.tone = f.state; g.add(p); own.points.push(p); box(f.after, f.state); }
      if (f.state === "moved" && f.before && f.after) { const a = new THREE.Vector3(...f.before.centroid), b = new THREE.Vector3(...f.after.centroid), d = b.clone().sub(a), L = d.length(); const ar = new THREE.ArrowHelper(d.normalize(), a, L, 0xffffff, Math.min(0.12, L * 0.3), Math.min(0.06, L * 0.15)); g.add(ar); own.arrow = ar; }
      own.bal.className = "bal absolute left-0 top-0 -ml-[14px] -mt-[14px] pointer-events-auto transition-opacity"; own.bal.textContent = String(f.n); own.bal.setAttribute("aria-label", `Finding ${f.n}: ${f.sentence}`);
      own.bal.addEventListener("click", () => { const cur = useSurvey.getState().selected; select(f.id === cur ? null : f.id); }); balRef.current!.appendChild(own.bal); per.set(f.id, own); }
    const c3 = (n: string) => new THREE.Color(css(n));
    const theme = () => { const s = useSurvey.getState(); scene.background = c3("--paper"); (grid.material as THREE.LineBasicMaterial).color = c3("--grid"); (G.unobs.material as THREE.PointsMaterial).color = c3("--unobserved");
      camLines.before.forEach((l) => (l.material as THREE.LineBasicMaterial).color.copy(c3("--ink-3"))); camLines.after.forEach((l) => (l.material as THREE.LineBasicMaterial).color.copy(c3("--ink-2")));
      per.forEach((own, id) => { const rej = s.status[id] === "rejected"; own.points.forEach((p) => (p.material as THREE.PointsMaterial).color.copy(rej ? c3("--ink-3") : c3(`--${p.userData.tone}`))); own.lines.forEach((l) => (l.material as THREE.LineBasicMaterial).color.copy(id === s.selected ? c3("--ink") : rej ? c3("--ink-3") : c3(`--${l.userData.tone}`))); own.arrow?.setColor(rej ? c3("--ink-3") : c3("--moved")); }); };
    const apply = () => { const s = useSurvey.getState(); G.before.visible = s.layers.stable && s.base === "before"; G.after.visible = s.layers.stable && s.base === "after"; G.unobs.visible = s.layers.unobserved; camG.visible = s.layers.cameras;
      [G.before, G.after].forEach((p) => ((p.material as THREE.PointsMaterial).opacity = s.selected ? 0.35 : 1)); per.forEach((own, id) => own.bal.classList.toggle("sel", id === s.selected)); theme(); };
    let fly: { from: { t: THREE.Vector3; d: number }; to: { t: THREE.Vector3; d: number }; t0: number } | null = null;
    const flyTo = (f: Finding) => { const b = (f.after ?? f.before)!; const t = new THREE.Vector3(...b.centroid).applyMatrix4(W2T), d = Math.max(1.5, Math.max(...b.obb.extent) * 4); if (matchMedia("(prefers-reduced-motion: reduce)").matches) { ctl.target.copy(t); ctl.dist = d; return; } fly = { from: { t: ctl.target.clone(), d: ctl.dist }, to: { t, d }, t0: performance.now() }; };
    const unsub = useSurvey.subscribe((s, prev) => { apply(); if (s.selected && s.selected !== prev.selected) { const f = data.findings.find((x) => x.id === s.selected); if (f) flyTo(f); } });
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }; const ro = new ResizeObserver(resize); ro.observe(el); resize();
    const mq = matchMedia("(prefers-color-scheme: dark)"); mq.addEventListener("change", theme); const mo = new MutationObserver(theme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const cv = renderer.domElement; cv.className = "block w-full h-full cursor-grab touch-none"; const ray = new THREE.Raycaster(); let drag: { x: number; y: number; pan: boolean; moved: boolean } | null = null;
    const cast = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera); const h = ray.intersectObjects(pickables, false); return h.length ? (h[0].object.userData.id as string) : null; };
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2, moved: false }; cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!drag) { const id = cast(e); cv.style.cursor = id ? "pointer" : "grab"; const r = el.getBoundingClientRect(); onTip(id, e.clientX - r.left, e.clientY - r.top); return; } const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (drag.pan) { const r = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), u = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1); ctl.target.addScaledVector(r, -dx * ctl.dist * 0.0015).addScaledVector(u, dy * ctl.dist * 0.0015); } else { ctl.theta -= dx * 0.006; ctl.phi = Math.min(Math.PI - 0.08, Math.max(0.08, ctl.phi - dy * 0.006)); } };
    const up = (e: PointerEvent) => { if (drag && !drag.moved) { const id = cast(e); const cur = useSurvey.getState().selected; select(id === cur ? null : id); } drag = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); ctl.dist = Math.min(20, Math.max(0.3, ctl.dist * (1 + e.deltaY * 0.001))); };
    const ctx = (e: Event) => e.preventDefault(); const leave = () => onTip(null, 0, 0);
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up); cv.addEventListener("pointerleave", leave); cv.addEventListener("wheel", wheel, { passive: false }); cv.addEventListener("contextmenu", ctx);
    const tmp = new THREE.Vector3(); let raf = 0;
    const loop = (now: number) => { if (fly) { const k = Math.min(1, (now - fly.t0) / 420), e = 1 - Math.pow(1 - k, 3); ctl.target.lerpVectors(fly.from.t, fly.to.t, e); ctl.dist = fly.from.d + (fly.to.d - fly.from.d) * e; if (k >= 1) fly = null; }
      const s = Math.sin(ctl.phi); camera.position.set(ctl.target.x + ctl.dist * s * Math.sin(ctl.theta), ctl.target.y + ctl.dist * Math.cos(ctl.phi), ctl.target.z + ctl.dist * s * Math.cos(ctl.theta)); camera.lookAt(ctl.target); renderer.render(scene, camera);
      const w = el.clientWidth, h = el.clientHeight; per.forEach((own, id) => { const f = data.findings.find((x) => x.id === id)!; const b = (f.after ?? f.before)!; tmp.set(b.centroid[0], b.centroid[1], b.centroid[2] + b.obb.extent[2] * 0.6).applyMatrix4(W2T).project(camera); own.bal.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`; own.bal.style.opacity = tmp.z > 1 ? "0" : "1"; });
      raf = requestAnimationFrame(loop); };
    apply(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); mq.removeEventListener("change", theme); mo.disconnect(); cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); cv.removeEventListener("pointerleave", leave); cv.removeEventListener("wheel", wheel); cv.removeEventListener("contextmenu", ctx); per.forEach((o) => o.bal.remove()); renderer.dispose(); cv.remove(); };
  }, [data, select, onTip]);
  return <div ref={mount} className="absolute inset-0"><div ref={balRef} className="absolute inset-0 pointer-events-none overflow-hidden" /></div>;
}
