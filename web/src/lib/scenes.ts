import { promises as fs } from "node:fs";
import path from "node:path";

/** Pipeline outputs live at <repo>/outputs/<scene>/ ; the viewer reads them in place. */
export const OUTPUTS_DIR = process.env.SPATIALITY_OUTPUTS ?? path.resolve(process.cwd(), "..", "outputs");

export async function listScenes(): Promise<{ id: string; mtime: number }[]> {
  try {
    const entries = await fs.readdir(OUTPUTS_DIR, { withFileTypes: true });
    const scenes = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const st = await fs.stat(path.join(OUTPUTS_DIR, e.name, "changes.json"));
        scenes.push({ id: e.name, mtime: st.mtimeMs });
      } catch { /* not finished */ }
    }
    return scenes.sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

export function sceneFile(scene: string, rel: string): string | null {
  const root = path.join(OUTPUTS_DIR, scene);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) return null; // no path traversal
  return full;
}
