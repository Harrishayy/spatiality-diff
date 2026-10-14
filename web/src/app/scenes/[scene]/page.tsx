import { promises as fs } from "node:fs";
import { notFound } from "next/navigation";
import Survey from "@/components/Survey";
import { sceneFile } from "@/lib/scenes";
import type { CamerasPayload, ChangesPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ScenePage({ params }: { params: Promise<{ scene: string }> }) {
  const { scene } = await params;
  const cp = sceneFile(scene, "changes.json"), kp = sceneFile(scene, "cameras.json");
  if (!cp || !kp) notFound();
  let changes: ChangesPayload, cameras: CamerasPayload;
  try { changes = JSON.parse(await fs.readFile(cp, "utf8")); cameras = JSON.parse(await fs.readFile(kp, "utf8")); } catch { notFound(); }
  return <Survey scene={scene} changes={changes} cameras={cameras} />;
}
