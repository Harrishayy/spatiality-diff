import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import type { Cloud } from "./types";

const loader = new PLYLoader();

/** Load a binary PLY written by open3d into flat position / colour arrays. */
export async function loadCloud(url: string): Promise<Cloud> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const geo = loader.parse(await res.arrayBuffer());
  const pos = geo.getAttribute("position").array as Float32Array;
  const c = geo.getAttribute("color");
  const rgb = c ? (c.array as Float32Array) : new Float32Array(pos.length).fill(0.5);
  return { pos, rgb, n: pos.length / 3 };
}
