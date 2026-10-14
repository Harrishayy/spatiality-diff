"""Projection helpers shared by registration, diff and evidence rendering. Pure numpy."""

from __future__ import annotations

import numpy as np


def project(points_w: np.ndarray, extrinsic: np.ndarray, intrinsic: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """World points (N,3) -> pixel coords (N,2) and camera depth (N,).

    extrinsic is cam-from-world 3x4 (OpenCV). Depth <= 0 means behind the camera.
    """
    R, t = extrinsic[:, :3], extrinsic[:, 3]
    pc = points_w @ R.T + t
    z = pc[:, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        uv = pc[:, :2] / z[:, None]
    uv = uv @ intrinsic[:2, :2].T + intrinsic[:2, 2]
    return uv, z


def sample_depth(depth: np.ndarray, uv: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Nearest-pixel depth lookup. Returns (depth_at_uv, inside_mask)."""
    h, w = depth.shape
    u = np.round(uv[:, 0]).astype(int)
    v = np.round(uv[:, 1]).astype(int)
    inside = (u >= 0) & (u < w) & (v >= 0) & (v < h)
    d = np.zeros(len(uv), dtype=np.float32)
    d[inside] = depth[v[inside], u[inside]]
    return d, inside


def apply_transform(points: np.ndarray, T: np.ndarray) -> np.ndarray:
    """Apply a 4x4 (optionally scaled) rigid transform to (N,3) points."""
    return points @ T[:3, :3].T + T[:3, 3]


def compose_extrinsic(extrinsic: np.ndarray, T_world: np.ndarray) -> np.ndarray:
    """If world' = T_world @ world, the new cam-from-world' is E @ inv(T_world)."""
    E = np.eye(4)
    E[:3, :4] = extrinsic
    return (E @ np.linalg.inv(T_world))[:3, :4]


def voxel_downsample(points: np.ndarray, colors: np.ndarray | None, voxel: float) -> tuple[np.ndarray, np.ndarray | None, np.ndarray]:
    """Keep one point per voxel. Returns (points, colors, index_of_kept_points)."""
    keys = np.floor(points / voxel).astype(np.int64)
    _, idx = np.unique(keys, axis=0, return_index=True)
    idx.sort()
    return points[idx], (colors[idx] if colors is not None else None), idx
