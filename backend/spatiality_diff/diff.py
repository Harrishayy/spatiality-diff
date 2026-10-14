"""Stage 4: visibility-aware 3D diff. The core of the project. Pure numpy + scipy + open3d.

For every point p of capture A we ask each camera of capture B that could see p:
  z     = depth of p in that camera
  d_B   = B's reconstructed depth at the pixel p projects to
  d_B > z + tau   -> the ray passed THROUGH p's location: B saw free space there  (vote: free)
  |d_B - z| < tau -> B saw a surface where p is                                   (vote: same)
  d_B < z - tau   -> something in B occludes p from this camera                   (vote: occluded, no evidence)
  outside image or behind camera                                                  (no evidence)
A point is REMOVED (A=before) or ADDED (A=after) when it has enough `free` votes
and few `same` votes. A point with no evidence at all is UNOBSERVED and is never
reported as a change; that is what separates viewpoint gaps from real changes.

tau scales with depth because feed-forward depth error does. Everything is in the
model's scale; `scale_m` converts if a metric estimate is known (Pi3X / MapAnything
give one, VGGT does not; the CLI estimates one from the floor-to-ceiling height
if asked).
"""

from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

from .geometry import project, sample_depth, voxel_downsample
from .contracts import Blob, Recon


def observe(points: np.ndarray, other: Recon, tau_rel: float = 0.04, tau_abs: float = 0.03) -> dict[str, np.ndarray]:
    """Vote counts per point from every frame of `other`. Returns dict of (N,) int arrays + best frame index."""
    n = len(points)
    free = np.zeros(n, np.int32)
    same = np.zeros(n, np.int32)
    occl = np.zeros(n, np.int32)
    looked = np.zeros(n, np.int32)
    best_frame = np.full(n, -1, np.int32)
    best_score = np.full(n, -1.0, np.float32)
    for j in range(other.n_frames):
        uv, z = project(points, other.extrinsics[j], other.intrinsics[j])
        d, inside = sample_depth(other.depth[j], uv)
        ok = inside & (z > 1e-3) & (d > 1e-3)
        if not ok.any():
            continue
        tau = tau_abs + tau_rel * z[ok]
        diff = d[ok] - z[ok]
        idx = np.flatnonzero(ok)
        f = diff > tau
        s = np.abs(diff) <= tau
        o = diff < -tau
        free[idx[f]] += 1
        same[idx[s]] += 1
        occl[idx[o]] += 1
        looked[idx[f | s]] += 1
        # "best" frame = the one that looked at the location most centrally (for evidence crops)
        h, w = other.hw
        cen = 1.0 - (np.abs(uv[idx, 0] - w / 2) / (w / 2) + np.abs(uv[idx, 1] - h / 2) / (h / 2)) / 2
        cen = np.where(f | s, cen, -1.0)
        upd = cen > best_score[idx]
        best_score[idx[upd]] = cen[upd]
        best_frame[idx[upd]] = j
    return dict(free=free, same=same, occluded=occl, looked=looked, best_frame=best_frame)


def classify(votes: dict[str, np.ndarray], min_free: int = 3, max_same_ratio: float = 0.25) -> tuple[np.ndarray, np.ndarray]:
    """-> (changed mask, unobserved mask). Changed = enough free-space votes and mostly no 'same' votes."""
    looked = votes["looked"]
    free = votes["free"]
    same = votes["same"]
    unobserved = looked == 0
    with np.errstate(divide="ignore", invalid="ignore"):
        same_ratio = np.where(looked > 0, same / np.maximum(looked, 1), 0.0)
    changed = (free >= min_free) & (same_ratio <= max_same_ratio)
    return changed, unobserved


def self_best_frame(points: np.ndarray, own: Recon) -> np.ndarray:
    """For each point, the frame of its OWN capture that sees it most centrally (for the 'before' crop)."""
    best = np.full(len(points), 0, np.int32)
    score = np.full(len(points), -1.0, np.float32)
    h, w = own.hw
    for j in range(own.n_frames):
        uv, z = project(points, own.extrinsics[j], own.intrinsics[j])
        d, inside = sample_depth(own.depth[j], uv)
        vis = inside & (z > 1e-3) & (np.abs(d - z) <= 0.03 + 0.04 * np.abs(z))
        cen = 1.0 - (np.abs(uv[:, 0] - w / 2) / (w / 2) + np.abs(uv[:, 1] - h / 2) / (h / 2)) / 2
        cen = np.where(vis, cen, -1.0)
        upd = cen > score
        score[upd] = cen[upd]
        best[upd] = j
    return best


def cluster_blobs(
    points: np.ndarray, colors: np.ndarray, votes: dict[str, np.ndarray], changed: np.ndarray,
    capture: str, own: Recon, voxel: float = 0.02, min_points: int = 80, min_extent: float = 0.05,
) -> list[Blob]:
    """DBSCAN the changed points into objects; drop slivers (registration noise, depth bleeding at edges).

    eps is tied to the voxel size: on a voxelised surface a point has ~8 neighbours within 2.5 voxels,
    so the DBSCAN core threshold must stay small; `min_points` then filters whole clusters.
    """
    import open3d as o3d

    eps = voxel * 2.5

    idx = np.flatnonzero(changed)
    if len(idx) < min_points:
        return []
    P = points[idx]
    pcd = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P.astype(np.float64)))
    labels = np.asarray(pcd.cluster_dbscan(eps=eps, min_points=5, print_progress=False))
    own_best = self_best_frame(P, own)
    blobs: list[Blob] = []
    for k in range(labels.max() + 1 if labels.size else 0):
        m = labels == k
        if m.sum() < min_points:
            continue
        sub = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P[m].astype(np.float64)))
        try:
            obb = sub.get_oriented_bounding_box()
        except RuntimeError:
            obb = sub.get_axis_aligned_bounding_box()
            obb = o3d.geometry.OrientedBoundingBox(obb.get_center(), np.eye(3), obb.get_extent())
        ext = np.asarray(obb.extent)
        if np.sort(ext)[1] < min_extent:  # thin sliver: at most one real dimension
            continue
        sel = idx[m]
        bf = votes["best_frame"][sel]
        bf = bf[bf >= 0]
        blobs.append(Blob(
            id=f"{capture[0]}{len(blobs):02d}",
            capture=capture,
            points=P[m].astype(np.float32),
            colors=colors[sel],
            centroid=P[m].mean(0),
            obb_center=np.asarray(obb.center),
            obb_extent=ext,
            obb_rotation=np.asarray(obb.R),
            support_free=int(np.median(votes["free"][sel])),
            support_total=int(np.median(votes["looked"][sel])),
            best_frame_self=int(np.bincount(own_best[m]).argmax()),
            best_frame_other=int(np.bincount(bf).argmax()) if bf.size else 0,
        ))
    blobs.sort(key=lambda b: -len(b.points))
    return blobs


def color_hist(colors: np.ndarray, bins: int = 4) -> np.ndarray:
    h, _ = np.histogramdd(colors.astype(np.float32), bins=bins, range=[(0, 256)] * 3)
    h = h.reshape(-1)
    return h / max(h.sum(), 1)


def match_moved(removed: list[Blob], added: list[Blob], max_extent_ratio: float = 1.6, min_score: float = 0.45) -> list[tuple[int, int, float]]:
    """Pair removed and added blobs that look like the same object (size + colour). Labels can veto later."""
    from scipy.optimize import linear_sum_assignment

    if not removed or not added:
        return []
    S = np.zeros((len(removed), len(added)))
    for i, r in enumerate(removed):
        er = np.sort(r.obb_extent)
        hr = color_hist(r.colors)
        for j, a in enumerate(added):
            ea = np.sort(a.obb_extent)
            ratio = np.maximum(er, ea) / np.maximum(np.minimum(er, ea), 1e-3)
            size_ok = float((ratio < max_extent_ratio).all())
            size_score = 1.0 - np.clip((ratio - 1).mean() / (max_extent_ratio - 1), 0, 1)
            col_score = float(np.minimum(hr, color_hist(a.colors)).sum())  # histogram intersection
            S[i, j] = size_ok * (0.5 * size_score + 0.5 * col_score)
    ri, aj = linear_sum_assignment(-S)
    return [(int(i), int(j), float(S[i, j])) for i, j in zip(ri, aj) if S[i, j] >= min_score]


def run_diff(before: Recon, after: Recon, voxel: float = 0.02, min_free: int = 3) -> dict:
    """Full diff. Returns clouds, per-point states and blobs. Both Recons must already share a frame."""
    from .recon import recon_to_cloud

    bp, bc = recon_to_cloud(before)
    ap, ac = recon_to_cloud(after)
    bp, bc, _ = voxel_downsample(bp, bc, voxel)
    ap, ac, _ = voxel_downsample(ap, ac, voxel)

    vb = observe(bp, after)          # before points judged by after cameras
    va = observe(ap, before)         # after points judged by before cameras
    b_changed, b_unobs = classify(vb, min_free=min_free)
    a_changed, a_unobs = classify(va, min_free=min_free)

    # a point that has a close neighbour in the other cloud is not a change, whatever the depth votes say
    # (guards against depth-map holes producing false free-space votes)
    tree_a = cKDTree(ap)
    tree_b = cKDTree(bp)
    b_changed &= tree_a.query(bp, distance_upper_bound=voxel * 2.5)[0] == np.inf
    a_changed &= tree_b.query(ap, distance_upper_bound=voxel * 2.5)[0] == np.inf

    removed = cluster_blobs(bp, bc, vb, b_changed, "before", before, voxel=voxel)
    added = cluster_blobs(ap, ac, va, a_changed, "after", after, voxel=voxel)
    pairs = match_moved(removed, added)

    coverage = float(1.0 - b_unobs.mean()) if len(bp) else 0.0
    return dict(
        before_points=bp, before_colors=bc, before_unobserved=b_unobs, before_changed=b_changed,
        after_points=ap, after_colors=ac, after_unobserved=a_unobs, after_changed=a_changed,
        removed=removed, added=added, pairs=pairs, coverage=coverage,
    )
