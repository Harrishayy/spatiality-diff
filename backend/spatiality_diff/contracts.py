"""Shared data contracts. Every stage reads and writes these, nothing else."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np

ChangeState = Literal["added", "removed", "moved"]


@dataclass
class Recon:
    """One capture's reconstruction, in the SHARED world frame.

    All arrays are per keyframe. Cameras use the OpenCV convention
    (x right, y down, z forward); `extrinsics` is cam-from-world 3x4.
    Depth and world_points are at the model's working resolution (H, W),
    which is also the resolution of `frames`.
    """

    capture: str                      # "before" | "after"
    frame_paths: list[Path]           # keyframes on disk, length S
    frame_ids: list[str]              # "0127" style ids, length S
    extrinsics: np.ndarray            # (S, 3, 4)
    intrinsics: np.ndarray            # (S, 3, 3)
    depth: np.ndarray                 # (S, H, W) float32
    depth_conf: np.ndarray            # (S, H, W) float32, higher is better
    world_points: np.ndarray          # (S, H, W, 3) float32
    colors: np.ndarray                # (S, H, W, 3) uint8

    @property
    def n_frames(self) -> int:
        return len(self.frame_paths)

    @property
    def hw(self) -> tuple[int, int]:
        return int(self.depth.shape[1]), int(self.depth.shape[2])

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            path,
            capture=self.capture,
            frame_paths=np.array([str(p) for p in self.frame_paths]),
            frame_ids=np.array(self.frame_ids),
            extrinsics=self.extrinsics.astype(np.float32),
            intrinsics=self.intrinsics.astype(np.float32),
            depth=self.depth.astype(np.float32),
            depth_conf=self.depth_conf.astype(np.float32),
            world_points=self.world_points.astype(np.float32),
            colors=self.colors.astype(np.uint8),
        )

    @classmethod
    def load(cls, path: Path) -> "Recon":
        z = np.load(path, allow_pickle=False)
        return cls(
            capture=str(z["capture"]),
            frame_paths=[Path(p) for p in z["frame_paths"].tolist()],
            frame_ids=z["frame_ids"].tolist(),
            extrinsics=z["extrinsics"],
            intrinsics=z["intrinsics"],
            depth=z["depth"],
            depth_conf=z["depth_conf"],
            world_points=z["world_points"],
            colors=z["colors"],
        )


@dataclass
class Blob:
    """A cluster of changed points in the shared frame."""

    id: str
    capture: str                      # which capture the points come from
    points: np.ndarray                # (N, 3)
    colors: np.ndarray                # (N, 3) uint8
    centroid: np.ndarray              # (3,)
    obb_center: np.ndarray            # (3,)
    obb_extent: np.ndarray            # (3,) metres (model scale)
    obb_rotation: np.ndarray          # (3, 3)
    support_free: int                 # how many other-capture frames saw free space here (removed/added evidence)
    support_total: int                # how many other-capture frames looked at this region at all
    best_frame_self: int              # index of the frame in its own capture that sees it best
    best_frame_other: int             # index of the frame in the other capture that looked at the location


@dataclass
class Change:
    id: str
    state: ChangeState
    label: str = "region"
    description: str = ""
    confidence: float = 0.0
    before_blob: Blob | None = None   # removed / moved: the old geometry
    after_blob: Blob | None = None    # added / moved: the new geometry
    displacement_m: float | None = None
    rotation_deg: float | None = None
    evidence: dict = field(default_factory=dict)  # frame ids + crop paths, filled by report
