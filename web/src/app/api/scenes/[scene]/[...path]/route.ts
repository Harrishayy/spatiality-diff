import { promises as fs } from "node:fs";
import { sceneFile } from "@/lib/scenes";

const TYPES: Record<string, string> = { json: "application/json", ply: "application/octet-stream", jpg: "image/jpeg", png: "image/png", md: "text/markdown" };

export async function GET(_req: Request, ctx: { params: Promise<{ scene: string; path: string[] }> }) {
  const { scene, path: parts } = await ctx.params;
  const full = sceneFile(scene, parts.join("/"));
  if (!full) return new Response("bad path", { status: 400 });
  try {
    const data = await fs.readFile(full);
    const ext = full.split(".").pop() ?? "";
    return new Response(new Uint8Array(data), { headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
