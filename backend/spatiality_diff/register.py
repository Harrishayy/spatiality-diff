"""Stage 3: refine the shared frame on the STATIC background only.

The joint pass already puts both captures in one frame, but the moved objects
are conflicting evidence inside that pass. We re-estimate a rigid transform
after -> before using only points that agree, iterating:
  ICP with a robust (Tukey) kernel  ->  drop high-residual clusters  ->  ICP again.
The dropped clusters are the first hint of what changed; the diff stage does
the real decision with visibility reasoning.

Cost: Open3D on ~100k voxel-downsampled points, a few seconds on a laptop CPU.
"""

from __future__ import annotations

import numpy as np

from .geometry import apply_transform, voxel_downsample


def refine_alignment(
    before_pts: np.ndarray,
    after_pts: np.ndarray,
    voxel: float = 0.03,
    max_corr: float = 0.15,
    rounds: int = 3,
) -> tuple[np.ndarray, float]:
    """Return (T_after_to_before 4x4, inlier_rmse). Starts from identity because the joint pass is already close."""
    import open3d as o3d

    b, _, _ = voxel_downsample(before_pts, None, voxel)
    a, _, _ = voxel_downsample(after_pts, None, voxel)
    tgt = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(b.astype(np.float64)))
    tgt.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=voxel * 4, max_nn=30))
    T = np.eye(4)
    a_cur = a.copy()
    rmse = float("nan")
    crit = o3d.pipelines.registration.ICPConvergenceCriteria(max_iteration=60)
    loss = o3d.pipelines.registration.TukeyLoss(k=max_corr / 2)
    est = o3d.pipelines.registration.TransformationEstimationPointToPlane(loss)
    for r in range(rounds):
        src = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(a_cur.astype(np.float64)))
        res = o3d.pipelines.registration.registration_icp(src, tgt, max_corr, np.eye(4), est, crit)
        T = res.transformation @ T
        rmse = float(res.inlier_rmse)
        a_cur = apply_transform(a, T)
        if r < rounds - 1:
            # points still far from the target are change candidates, not alignment evidence: drop them
            d = np.asarray(o3d.geometry.PointCloud(o3d.utility.Vector3dVector(a_cur)).compute_point_cloud_distance(tgt))
            keep = d < max_corr
            if keep.sum() < 1000:
                break
            a, a_cur = a[keep], a_cur[keep]
    return T, rmse
