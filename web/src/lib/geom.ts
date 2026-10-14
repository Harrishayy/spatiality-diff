import type { BlobJson, CameraJson } from "./types";

export type Pt = [number, number];

export function hull(p: Pt[]): Pt[] {
  p = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const x = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && x(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && x(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Convex hull on the floor of an oriented box: all 8 corners projected to xy. */
export function footprint(b: BlobJson): Pt[] {
  const R = b.obb.rotation, c = b.obb.center, e = b.obb.extent.map((x) => x / 2);
  const all: Pt[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
    all.push([c[0] + R[0][0] * sx * e[0] + R[0][1] * sy * e[1] + R[0][2] * sz * e[2], c[1] + R[1][0] * sx * e[0] + R[1][1] * sy * e[1] + R[1][2] * sz * e[2]]);
  return hull(all);
}

export function centroid(pts: Pt[]): Pt { return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]; }

export function inPoly(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
}

/** Camera centre and forward direction in world from a cam-from-world 3x4. */
export function camPose(c: CameraJson): { eye: [number, number, number]; fwd: [number, number, number] } {
  const E = c.cam_from_world; const R = [E[0].slice(0, 3), E[1].slice(0, 3), E[2].slice(0, 3)], t = [E[0][3], E[1][3], E[2][3]];
  const eye: [number, number, number] = [-(R[0][0] * t[0] + R[1][0] * t[1] + R[2][0] * t[2]), -(R[0][1] * t[0] + R[1][1] * t[1] + R[2][1] * t[2]), -(R[0][2] * t[0] + R[1][2] * t[1] + R[2][2] * t[2])];
  return { eye, fwd: [R[2][0], R[2][1], R[2][2]] };
}
