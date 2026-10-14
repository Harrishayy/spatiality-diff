"""Stage 2: keyframes of BOTH captures -> one shared 3D frame.

Why one joint pass: VGGT-family models accept an unordered image set and put
every frame in the coordinate system of the first image. Feeding before+after
keyframes together therefore gives a shared frame for free, with no scale
ambiguity between the two captures. Moved objects are a small fraction of the
pixels, so the static room dominates the attention. The result is refined on
the static background in `register.py`.

The model call is isolated in `run_backend()` so the same code runs on Modal
(modal_app.py) or locally (scripts/run_local.py). Backends:
  vggt-omega  (default) facebook/VGGT-Omega, gated, non-commercial research licence
  vggt        facebook/VGGT-1B (or VGGT-1B-Commercial)
  pi3x        yyfz/Pi3X, permutation-equivariant, approx. metric
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from .contracts import Recon

BACKENDS = ("vggt-omega", "vggt", "pi3x")


def _load_vggt_like(backend: str, device):
    import torch

    if backend == "vggt-omega":
        # VERIFY on first run: the public repo is github.com/facebookresearch/vggt-omega.
        # It keeps VGGT's module layout (vggt.models.vggt.VGGT) with a different checkpoint id.
        from vggt.models.vggt import VGGT  # type: ignore

        model = VGGT.from_pretrained("facebook/VGGT-Omega")
    elif backend == "vggt":
        from vggt.models.vggt import VGGT  # type: ignore

        model = VGGT.from_pretrained("facebook/VGGT-1B")
    else:
        raise ValueError(backend)
    return model.to(device).eval()


def run_backend(image_paths: list[Path], backend: str = "vggt-omega", device: str | None = None) -> dict:
    """Run the model over ALL images (both captures) in one forward pass.

    Returns numpy arrays: extrinsics (S,3,4), intrinsics (S,3,3), depth (S,H,W),
    depth_conf (S,H,W), world_points (S,H,W,3), images (S,H,W,3) uint8.
    """
    import torch

    if device is None:
        device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")

    if backend in ("vggt-omega", "vggt"):
        from vggt.utils.geometry import unproject_depth_map_to_point_map  # type: ignore
        from vggt.utils.load_fn import load_and_preprocess_images  # type: ignore
        from vggt.utils.pose_enc import pose_encoding_to_extri_intri  # type: ignore

        model = _load_vggt_like(backend, device)
        images = load_and_preprocess_images([str(p) for p in image_paths]).to(device)  # (S,3,H,W) in [0,1]
        use_bf16 = device == "cuda" and torch.cuda.get_device_capability()[0] >= 8
        dtype = torch.bfloat16 if use_bf16 else torch.float16 if device == "cuda" else torch.float32
        with torch.no_grad():
            ctx = torch.autocast(device_type="cuda", dtype=dtype) if device == "cuda" else torch.autocast(device_type="cpu", enabled=False)
            with ctx:
                pred = model(images)
        extrinsic, intrinsic = pose_encoding_to_extri_intri(pred["pose_enc"], images.shape[-2:])
        extrinsic = extrinsic[0].float().cpu().numpy()
        intrinsic = intrinsic[0].float().cpu().numpy()
        depth = pred["depth"][0, ..., 0].float().cpu().numpy()
        depth_conf = pred["depth_conf"][0].float().cpu().numpy()
        world_points = unproject_depth_map_to_point_map(depth[..., None], extrinsic, intrinsic).astype(np.float32)
        imgs = (images.permute(0, 2, 3, 1).float().cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
        return dict(extrinsics=extrinsic, intrinsics=intrinsic, depth=depth, depth_conf=depth_conf, world_points=world_points, images=imgs)

    if backend == "pi3x":
        # VERIFY on first run against github.com/yyfz/Pi3 (Pi3X release, Dec 2025).
        from pi3.models.pi3 import Pi3  # type: ignore
        from pi3.utils.basic import load_images_as_tensor  # type: ignore

        model = Pi3.from_pretrained("yyfz233/Pi3X").to(device).eval()
        imgs = load_images_as_tensor([str(p) for p in image_paths]).to(device)[None]
        with torch.no_grad():
            with torch.autocast(device_type="cuda", dtype=torch.bfloat16) if device == "cuda" else torch.autocast(device_type="cpu", enabled=False):
                res = model(imgs)
        cam2world = res["camera_poses"][0].float().cpu().numpy()  # (S,4,4)
        extrinsic = np.linalg.inv(cam2world)[:, :3, :]
        world_points = res["points"][0].float().cpu().numpy().astype(np.float32)
        conf = res["conf"][0, ..., 0].float().cpu().numpy()
        local = res["local_points"][0].float().cpu().numpy()
        depth = local[..., 2]
        intrinsic = res["intrinsics"][0].float().cpu().numpy() if "intrinsics" in res else _intrinsics_from_local_points(local)
        im = (imgs[0].permute(0, 2, 3, 1).float().cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
        return dict(extrinsics=extrinsic, intrinsics=intrinsic, depth=depth, depth_conf=conf, world_points=world_points, images=im)

    raise ValueError(f"unknown backend {backend}; choose from {BACKENDS}")


def _intrinsics_from_local_points(local: np.ndarray) -> np.ndarray:
    """Least-squares pinhole fit per frame from camera-space points (fallback when a backend gives none)."""
    S, H, W, _ = local.shape
    vv, uu = np.mgrid[0:H, 0:W]
    out = np.zeros((S, 3, 3), np.float32)
    for s in range(S):
        p = local[s].reshape(-1, 3)
        ok = p[:, 2] > 1e-6
        x = p[ok, 0] / p[ok, 2]
        y = p[ok, 1] / p[ok, 2]
        A = np.stack([x, np.ones_like(x)], 1)
        fx, cx = np.linalg.lstsq(A, uu.reshape(-1)[ok], rcond=None)[0]
        A = np.stack([y, np.ones_like(y)], 1)
        fy, cy = np.linalg.lstsq(A, vv.reshape(-1)[ok], rcond=None)[0]
        out[s] = [[fx, 0, cx], [0, fy, cy], [0, 0, 1]]
    return out


def split_joint_output(out: dict, before_paths: list[Path], after_paths: list[Path]) -> tuple[Recon, Recon]:
    """The joint pass returns S = len(before)+len(after) frames in input order. Split them back."""
    nb = len(before_paths)

    def mk(capture, paths, sl):
        return Recon(
            capture=capture,
            frame_paths=list(paths),
            frame_ids=[p.stem for p in paths],
            extrinsics=out["extrinsics"][sl],
            intrinsics=out["intrinsics"][sl],
            depth=out["depth"][sl],
            depth_conf=out["depth_conf"][sl],
            world_points=out["world_points"][sl],
            colors=out["images"][sl],
        )

    return mk("before", before_paths, slice(0, nb)), mk("after", after_paths, slice(nb, None))


def recon_to_cloud(r: Recon, conf_quantile: float = 0.3, stride: int = 2) -> tuple[np.ndarray, np.ndarray]:
    """Flatten a Recon to (N,3) points and (N,3) colours, dropping the lowest-confidence pixels."""
    conf = r.depth_conf[:, ::stride, ::stride]
    pts = r.world_points[:, ::stride, ::stride].reshape(-1, 3)
    col = r.colors[:, ::stride, ::stride].reshape(-1, 3)
    thr = np.quantile(conf, conf_quantile)
    keep = (conf.reshape(-1) >= thr) & np.isfinite(pts).all(1)
    return pts[keep], col[keep]


def save_ply(path: Path, points: np.ndarray, colors: np.ndarray) -> None:
    import open3d as o3d

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points.astype(np.float64))
    pcd.colors = o3d.utility.Vector3dVector(colors.astype(np.float64) / 255.0)
    path.parent.mkdir(parents=True, exist_ok=True)
    o3d.io.write_point_cloud(str(path), pcd, write_ascii=False, compressed=False)
