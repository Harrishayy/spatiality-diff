export type ChangeState = "added" | "removed" | "moved";

export interface BlobJson {
  ply: string;
  n_points: number;
  centroid: [number, number, number];
  obb: { center: [number, number, number]; extent: [number, number, number]; rotation: number[][] };
  support: { free: number; looked: number };
  best_frame_self: number;
  best_frame_other: number;
}

export interface EvidenceSide { frame_id: string; crop: string; box?: [number, number, number, number] }

export interface ChangeJson {
  id: string;
  state: ChangeState;
  label: string;
  sentence: string;
  confidence: number;
  before?: BlobJson;
  after?: BlobJson;
  displacement_m?: number;
  rotation_deg?: number;
  evidence: { before?: EvidenceSide; after?: EvidenceSide };
}

export interface CameraJson { frame_id: string; path: string; K: number[][]; cam_from_world: number[][] }

export interface ChangesPayload {
  scene: string;
  units: "m" | "model";
  coverage: number;
  counts: { added: number; removed: number; moved: number };
  summary: string;
  changes: ChangeJson[];
  pipeline: Record<string, unknown>;
}

export interface CamerasPayload { before: CameraJson[]; after: CameraJson[] }

export type ViewMode = "before" | "after" | "diff" | "overlay";
