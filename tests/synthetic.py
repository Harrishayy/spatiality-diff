"""A synthetic room with known changes, rendered to depth maps with pinhole cameras.

Used by the unit test and by `scripts/make_demo.py` to exercise the whole non-GPU
pipeline (register -> diff -> report -> viewer) without a model or a video.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from spatiality_diff.contracts import Recon

H, W = 120, 160
K = np.array([[140.0, 0, W / 2], [0, 140.0, H / 2], [0, 0, 1]])


def room_boxes(moved_chair_dx: float = 0.0, with_lamp: bool = True, with_box: bool = False) -> list[tuple[np.ndarray, np.ndarray, tuple]]:
    """(min_corner, max_corner, colour) for walls/floor and objects. Metres, z up."""
    objs = [
        (np.array([-2.0, -2.0, -0.02]), np.array([2.0, 2.0, 0.0]), (120, 110, 100)),      # floor
        (np.array([-2.0, 1.98, 0.0]), np.array([2.0, 2.0, 2.4]), (200, 200, 195)),        # back wall
        (np.array([-2.0, -2.0, 0.0]), np.array([-1.98, 2.0, 2.4]), (190, 195, 200)),      # left wall
        (np.array([0.6, 1.2, 0.0]), np.array([1.6, 1.8, 0.75]), (90, 70, 50)),            # desk (stable)
        (np.array([-1.2 + moved_chair_dx, 0.6, 0.0]), np.array([-0.7 + moved_chair_dx, 1.1, 0.9]), (40, 60, 140)),  # chair
    ]
    if with_lamp:
        objs.append((np.array([-1.85, 1.55, 0.0]), np.array([-1.65, 1.75, 1.6]), (230, 200, 90)))   # floor lamp, back-left corner
    if with_box:
        objs.append((np.array([0.9, 1.3, 0.75]), np.array([1.3, 1.6, 1.05]), (170, 120, 70)))    # box on desk
    return objs


def _ray_box(o, d, bmin, bmax):
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = (bmin - o) / d
        t2 = (bmax - o) / d
    tmin = np.minimum(t1, t2).max(-1)
    tmax = np.maximum(t1, t2).min(-1)
    hit = (tmax >= np.maximum(tmin, 1e-4))
    return np.where(hit, tmin, np.inf)


def look_at(eye, target, up=(0, 0, 1)):
    f = np.asarray(target, float) - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, up); r /= np.linalg.norm(r)
    dn = np.cross(f, r)  # opencv y down
    R = np.stack([r, dn, f])  # rows = camera axes in world
    t = -R @ eye
    return np.concatenate([R, t[:, None]], 1)


def render(objs, extrinsic):
    R, t = extrinsic[:, :3], extrinsic[:, 3]
    eye = -R.T @ t
    vv, uu = np.mgrid[0:H, 0:W]
    dirs_c = np.stack([(uu - K[0, 2]) / K[0, 0], (vv - K[1, 2]) / K[1, 1], np.ones_like(uu, float)], -1)
    dirs_w = dirs_c.reshape(-1, 3) @ R
    tbest = np.full(len(dirs_w), np.inf)
    col = np.zeros((len(dirs_w), 3), np.uint8)
    for bmin, bmax, c in objs:
        tt = _ray_box(eye[None], dirs_w, bmin[None], bmax[None])
        m = tt < tbest
        tbest[m] = tt[m]
        col[m] = c
    pts = eye[None] + dirs_w * tbest[:, None]
    depth = (tbest * dirs_c.reshape(-1, 3)[:, 2]).reshape(H, W)  # z-depth
    depth[~np.isfinite(depth)] = 0
    pts[~np.isfinite(pts).all(1)] = 0
    return depth.astype(np.float32), pts.reshape(H, W, 3).astype(np.float32), col.reshape(H, W, 3)


def make_recon(capture: str, objs, cams: list[np.ndarray], out_dir: Path | None = None, noise: float = 0.01) -> Recon:
    rng = np.random.default_rng(0 if capture == "before" else 1)
    depths, pts, cols, ids, paths = [], [], [], [], []
    for i, E in enumerate(cams):
        d, p, c = render(objs, E)
        d = d + rng.normal(0, noise, d.shape).astype(np.float32) * (d > 0)
        depths.append(d); pts.append(p); cols.append(c)
        ids.append(f"{i:05d}")
        pth = (out_dir / f"{i:05d}.jpg") if out_dir else Path(f"{capture}_{i:05d}.jpg")
        if out_dir:
            from PIL import Image
            out_dir.mkdir(parents=True, exist_ok=True)
            Image.fromarray(c).save(pth)
        paths.append(pth)
    S = len(cams)
    return Recon(capture=capture, frame_paths=paths, frame_ids=ids,
                 extrinsics=np.stack(cams).astype(np.float32), intrinsics=np.repeat(K[None], S, 0).astype(np.float32),
                 depth=np.stack(depths), depth_conf=np.ones((S, H, W), np.float32),
                 world_points=np.stack(pts), colors=np.stack(cols))


def orbit_cams(n: int, radius: float = 1.4, height: float = 1.3, phase: float = 0.0, center=(0, 0.4, 0.6)):
    cams = []
    for k in range(n):
        a = phase + np.pi * 0.9 * k / max(n - 1, 1) - np.pi * 0.45 - np.pi / 2  # sweep facing +y (back wall)
        eye = np.array([center[0] + radius * np.cos(a), center[1] - abs(radius * np.sin(a)) - 0.6, height])
        cams.append(look_at(eye, center))
    return cams


def scene_pair(out_dir: Path | None = None, n: int = 24):
    before = make_recon("before", room_boxes(0.0, with_lamp=True, with_box=False), orbit_cams(n, phase=0.0), out_dir and out_dir / "before" / "keyframes")
    after = make_recon("after", room_boxes(0.8, with_lamp=False, with_box=True), orbit_cams(n, phase=0.15, radius=1.5), out_dir and out_dir / "after" / "keyframes")
    truth = dict(moved=["chair"], removed=["floor lamp"], added=["box"])
    return before, after, truth
