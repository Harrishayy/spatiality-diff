/* The plan renderer: a change-survey drawing on a 2D canvas. Pure functions over a view transform; no React. */
import { centroid, footprint, hull, inPoly, type Pt } from "./geom";
import type { Cloud, Finding, Verdict } from "./types";

export interface PlanView { s: number; ox: number; oy: number; w: number; h: number }
export interface PlanData {
  clouds: { before: Cloud; after: Cloud; unobserved: Cloud };
  cams: { before: { eye: number[]; fwd: number[] }[]; after: { eye: number[]; fwd: number[] }[] };
  findings: Finding[];
}
export interface PlanState { base: "before" | "after"; layers: { unobserved: boolean; cameras: boolean; stable: boolean }; selected: string | null; hover: string | null; status: Record<string, Verdict> }
interface Shape { id: string; before?: Pt[]; after?: Pt[] }
interface Balloon { x: number; y: number; r: number }

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hexToRgb = (h: string) => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const fontMono = () => css("--font-mono") || "JetBrains Mono, monospace";
const fontCond = () => css("--font-cond") || "Barlow Semi Condensed, sans-serif";

export class PlanRenderer {
  view: PlanView = { s: 160, ox: 0, oy: 0, w: 0, h: 0 };
  shapes: Shape[];
  balloons = new Map<string, Balloon>();
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = "";
  constructor(public canvas: HTMLCanvasElement, public data: PlanData) {
    this.shapes = data.findings.map((f) => ({ id: f.id, before: f.before && footprint(f.before), after: f.after && footprint(f.after) }));
  }
  toS(x: number, y: number): Pt { return [this.view.ox + x * this.view.s, this.view.oy - y * this.view.s]; }
  toW(px: number, py: number): Pt { return [(px - this.view.ox) / this.view.s, (this.view.oy - py) / this.view.s]; }
  resize() { const r = this.canvas.parentElement!.getBoundingClientRect(); const v = this.view; v.w = r.width; v.h = r.height; this.canvas.width = Math.round(r.width * devicePixelRatio); this.canvas.height = Math.round(r.height * devicePixelRatio); this.canvas.style.width = r.width + "px"; this.canvas.style.height = r.height + "px"; this.cache = null; }
  fit() { const p = this.data.clouds.after.pos; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    const pad = 0.6, v = this.view; v.s = Math.min(v.w / (x1 - x0 + 2 * pad), v.h / (y1 - y0 + 2 * pad)); v.ox = v.w / 2 - ((x0 + x1) / 2) * v.s; v.oy = v.h / 2 + ((y0 + y1) / 2) * v.s; }
  invalidate() { this.cache = null; }
  centerOf(id: string): Pt { const sh = this.shapes.find((s) => s.id === id)!; return centroid([...(sh.before ?? []), ...(sh.after ?? [])]); }

  private points(st: PlanState): HTMLCanvasElement {
    const v = this.view; const key = `${v.s}|${v.ox}|${v.oy}|${st.base}|${st.layers.stable}|${st.layers.unobserved}|${css("--paper")}`;
    if (this.cache && key === this.cacheKey) return this.cache; this.cacheKey = key;
    const off = document.createElement("canvas"); off.width = this.canvas.width; off.height = this.canvas.height; const g = off.getContext("2d")!; g.scale(devicePixelRatio, devicePixelRatio);
    const lo = hexToRgb(css("--shade-lo")), hi = hexToRgb(css("--shade-hi"));
    if (st.layers.stable) { const cl = this.data.clouds[st.base]; const r = Math.max(1, v.s * 0.012); const buckets: number[][] = Array.from({ length: 10 }, () => []);
      for (let i = 0; i < cl.pos.length; i += 3) { const z = cl.pos[i + 2]; if (z < -0.05) continue; const t = Math.min(0.999, Math.max(0, z / 2.2)); buckets[Math.floor(t * 10)].push(cl.pos[i], cl.pos[i + 1]); }
      buckets.forEach((b, k) => { const t = k / 9; g.fillStyle = `rgb(${mix(lo[0], hi[0], t)},${mix(lo[1], hi[1], t)},${mix(lo[2], hi[2], t)})`; for (let i = 0; i < b.length; i += 2) { const [x, y] = this.toS(b[i], b[i + 1]); g.fillRect(x - r / 2, y - r / 2, r, r); } }); }
    if (st.layers.unobserved) { g.strokeStyle = css("--unobserved"); g.lineWidth = 1; const u = this.data.clouds.unobserved.pos; const l = Math.max(2, v.s * 0.02); g.beginPath();
      for (let i = 0; i < u.length; i += 3) { const [x, y] = this.toS(u[i], u[i + 1]); g.moveTo(x - l / 2, y + l / 2); g.lineTo(x + l / 2, y - l / 2); } g.stroke(); }
    this.cache = off; return off;
  }
  private poly(g: CanvasRenderingContext2D, pts: Pt[]) { g.beginPath(); pts.forEach((p, i) => { const [x, y] = this.toS(p[0], p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); }
  private arrow(g: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, w = 1.5, head = 7) { const [ax, ay] = this.toS(a[0], a[1]), [bx, by] = this.toS(b[0], b[1]); const ang = Math.atan2(by - ay, bx - ax);
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - head * Math.cos(ang - 0.4), by - head * Math.sin(ang - 0.4)); g.lineTo(bx - head * Math.cos(ang + 0.4), by - head * Math.sin(ang + 0.4)); g.closePath(); g.fill(); }
  private dimension(g: CanvasRenderingContext2D, a: Pt, b: Pt, text: string, color: string) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, off = 0.28;
    const a2: Pt = [a[0] + nx * off, a[1] + ny * off], b2: Pt = [b[0] + nx * off, b[1] + ny * off];
    g.strokeStyle = color; g.lineWidth = 1; g.setLineDash([]);
    for (const [p, q] of [[a, [a[0] + nx * (off + 0.06), a[1] + ny * (off + 0.06)]], [b, [b[0] + nx * (off + 0.06), b[1] + ny * (off + 0.06)]]] as [Pt, Pt][]) { const [x1, y1] = this.toS(p[0], p[1]), [x2, y2] = this.toS(q[0], q[1]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    this.arrow(g, a2, b2, color, 1, 6); this.arrow(g, b2, a2, color, 1, 6);
    const [mx, my] = this.toS((a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2); let ang = Math.atan2(-(b2[1] - a2[1]), b2[0] - a2[0]); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    g.save(); g.translate(mx, my); g.rotate(ang); g.font = `500 12px ${fontMono()}`; g.textAlign = "center"; g.textBaseline = "bottom"; const tw = g.measureText(text).width;
    g.fillStyle = css("--paper"); g.fillRect(-tw / 2 - 4, -15, tw + 8, 15); g.fillStyle = color; g.fillText(text, 0, -3); g.restore(); }
  private hatch(g: CanvasRenderingContext2D, pts: Pt[], color: string) { const xs = pts.map((p) => this.toS(p[0], p[1])); const x0 = Math.min(...xs.map((p) => p[0])), x1 = Math.max(...xs.map((p) => p[0])), y0 = Math.min(...xs.map((p) => p[1])), y1 = Math.max(...xs.map((p) => p[1]));
    g.strokeStyle = color; g.lineWidth = 1; g.globalAlpha = 0.7; g.beginPath(); for (let d = x0 - (y1 - y0); d < x1; d += 7) { g.moveTo(d, y1); g.lineTo(d + (y1 - y0), y0); } g.stroke(); g.globalAlpha = 1; }

  draw(st: PlanState) {
    const g = this.canvas.getContext("2d")!; const v = this.view; g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); g.clearRect(0, 0, v.w, v.h);
    const paper = css("--paper"), grid = css("--grid"), ink = css("--ink"), ink2 = css("--ink-2"), ink3 = css("--ink-3");
    g.fillStyle = paper; g.fillRect(0, 0, v.w, v.h);
    const [wx0, wy1] = this.toW(0, 0), [wx1, wy0] = this.toW(v.w, v.h);
    for (let x = Math.floor(wx0 * 2) / 2; x <= wx1; x += 0.5) { const [sx] = this.toS(x, 0); g.strokeStyle = grid; g.lineWidth = Math.abs(x % 1) < 1e-6 ? 1 : 0.5; g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, v.h); g.stroke(); }
    for (let y = Math.floor(wy0 * 2) / 2; y <= wy1; y += 0.5) { const [, sy] = this.toS(0, y); g.strokeStyle = grid; g.lineWidth = Math.abs(y % 1) < 1e-6 ? 1 : 0.5; g.beginPath(); g.moveTo(0, sy); g.lineTo(v.w, sy); g.stroke(); }
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.points(st), 0, 0); g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    if (st.layers.cameras) for (const [k, list] of Object.entries(this.data.cams)) { g.strokeStyle = k === "before" ? ink3 : ink2; g.lineWidth = 1; g.setLineDash(k === "before" ? [3, 4] : []); g.beginPath();
      list.forEach((c, i) => { const [x, y] = this.toS(c.eye[0], c.eye[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
      list.forEach((c, i) => { if (i % 3) return; const [x, y] = this.toS(c.eye[0], c.eye[1]); const a = Math.atan2(-c.fwd[1], c.fwd[0]); g.fillStyle = k === "before" ? ink3 : ink2; g.beginPath(); g.moveTo(x + 7 * Math.cos(a), y + 7 * Math.sin(a)); g.lineTo(x + 5 * Math.cos(a + 2.4), y + 5 * Math.sin(a + 2.4)); g.lineTo(x + 5 * Math.cos(a - 2.4), y + 5 * Math.sin(a - 2.4)); g.closePath(); g.fill(); }); }
    for (const f of this.data.findings) { const sh = this.shapes.find((s) => s.id === f.id)!; const stt = st.status[f.id]; const color = stt === "rejected" ? ink3 : css(`--${f.state}`); const sel = f.id === st.selected, hov = f.id === st.hover;
      if (sel) { g.save(); const hp = hull([...(sh.before ?? []), ...(sh.after ?? [])]); this.poly(g, hp); g.lineWidth = 14; g.strokeStyle = css("--marker"); g.lineJoin = "round"; g.stroke(); g.restore(); }
      if (sh.before) { this.poly(g, sh.before); g.setLineDash(f.state === "removed" ? [5, 4] : [2, 3]); g.lineWidth = sel || hov ? 2 : 1.5; g.strokeStyle = f.state === "removed" ? color : stt === "rejected" ? ink3 : css("--removed"); g.stroke(); g.setLineDash([]);
        if (f.state === "removed") { g.save(); g.clip(); this.hatch(g, sh.before, color); g.restore(); } }
      if (sh.after) { this.poly(g, sh.after); g.fillStyle = color; g.globalAlpha = stt === "rejected" ? 0.15 : 0.28; g.fill(); g.globalAlpha = 1; g.lineWidth = sel || hov ? 2 : 1.5; g.strokeStyle = color; g.stroke(); }
      if (f.state === "moved" && f.before && f.after && f.displacement_m != null) { const a: Pt = [f.before.centroid[0], f.before.centroid[1]], b: Pt = [f.after.centroid[0], f.after.centroid[1]]; this.arrow(g, a, b, color, 1.5, 8); this.dimension(g, a, b, `${f.displacement_m.toFixed(2)} m`, stt === "rejected" ? ink3 : ink); }
      const pts = sh.after ?? sh.before!; const c = centroid(pts); const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))); const at: Pt = [c[0] + (r + 0.32) * 0.7071, c[1] + (r + 0.32) * 0.7071];
      const [ax, ay] = this.toS(c[0], c[1]), [bx, by] = this.toS(at[0], at[1]); g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      const R = sel ? 15 : 13; g.beginPath(); g.arc(bx, by, R, 0, Math.PI * 2); g.fillStyle = sel ? ink : paper; g.fill(); g.lineWidth = sel || hov ? 2 : 1.5; g.strokeStyle = ink; g.stroke();
      g.fillStyle = sel ? paper : ink; g.font = `600 13px ${fontCond()}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(f.n), bx, by + 0.5);
      if (stt) { g.beginPath(); g.arc(bx + R - 2, by - R + 2, 6, 0, Math.PI * 2); g.fillStyle = stt === "accepted" ? css("--ok") : ink3; g.fill(); g.strokeStyle = paper; g.lineWidth = 1.5; g.stroke(); g.fillStyle = "#fff"; g.font = `700 9px ${css("--font-sans")}`; g.fillText(stt === "accepted" ? "✓" : "✕", bx + R - 2, by - R + 2.5); }
      this.balloons.set(f.id, { x: bx, y: by, r: R }); }
    const bar = v.s; g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(24, v.h - 28); g.lineTo(24 + bar, v.h - 28); g.stroke(); for (const x of [24, 24 + bar / 2, 24 + bar]) { g.beginPath(); g.moveTo(x, v.h - 33); g.lineTo(x, v.h - 23); g.stroke(); }
    g.fillStyle = ink; g.font = `500 11px ${fontMono()}`; g.textAlign = "left"; g.textBaseline = "bottom"; g.fillText("0", 22, v.h - 36); g.textAlign = "right"; g.fillText("1 m", 24 + bar + 2, v.h - 36);
    g.textAlign = "left"; g.fillStyle = ink2; g.fillText("x →", 24, v.h - 8); g.save(); g.translate(14, v.h - 46); g.rotate(-Math.PI / 2); g.fillText("y →", 0, 0); g.restore();
  }
  hit(px: number, py: number): string | null {
    for (const [id, b] of this.balloons) if (Math.hypot(px - b.x, py - b.y) <= b.r + 4) return id;
    const w = this.toW(px, py); for (const sh of this.shapes) for (const pts of [sh.after, sh.before]) if (pts && inPoly(w, pts)) return sh.id; return null;
  }
}
