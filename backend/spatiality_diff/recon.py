"""Stage 2: keyframes of BOTH captures -> one shared 3D frame.

Why one joint pass: VGGT-family models accept an unordered image set and put
every frame in the coordinate system of the first image. Feeding before+after
keyframes together therefore gives a shared frame for free, with no scale
ambiguity between the two captures. Moved objects are a small fraction of the
pixels, so the static room dominates the attention. The result is refined on
the static background in `register.py`.

The model call is isolated in `run_backend()` so the same code runs on Modal
(modal_app.py) or locally (scripts/run_local.py). Backends:
  vggt-omega  (default) facebook/VGGT-Omega 1B-512, gated (automated approval), non-commercial
  vggt        facebook/VGGT-1B, open weights, non-commercial
  pi3x        yyfz233/Pi3X, permutation-equivariant, approx. metric, CC BY-NC

APIs verified against the repos' READMEs on 2026-10-14.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import numpy as np

from .contracts import Recon

BACKENDS = ("vggt-omega", "vggt", "pi3x")
OMEGA_REPO, OMEGA_FILE = "facebook/VGGT-Omega", "vggt_omega_1b_512.pt"


def unproject(depth: np.ndarray, extrinsics: np.ndarray, intrinsics: np.ndarray) -> np.ndarray:
    """(S,H,W) depth + cam-from-world (S,3,4) + K (S,3,3) -> (S,H,W,3) world points. Pure numpy, backend-agnostic."""
    S, H, W = depth.shape
    vv, uu = np.mgrid[0:H, 0:W].astype(np.float32)
    out = np.zeros((S, H, W, 3), np.float32)
    for s in range(S):
        K, E, d = intrinsics[s], extrinsics[s], depth[s]
        x = (uu - K[0, 2]) / K[0, 0] * d
        y = (vv - K[1, 2]) / K[1, 1] * d
        pc = np.stack([x, y, d], -1).reshape(-1, 3)
        R, t = E[:, :3], E[:, 3]
        out[s] = ((pc - t) @ R).reshape(H, W, 3)  # R^T (p - t)
    return out


def _device(device: str | None) -> str:
    import torch

    if device:
        return device
    return "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")


def _autocast(device: str):
    import torch

    if device == "cuda":
        dtype = torch.bfloat16 if torch.cuda.get_device_capability()[0] >= 8 else torch.float16
        return torch.autocast(device_type="cuda", dtype=dtype)
    return torch.autocast(device_type="cpu", enabled=False)


def _finish(images_t, extrinsic, intrinsic, depth, depth_conf) -> dict:
    """Common tail: to numpy, unproject, pack images."""
    imgs = (images_t.permute(0, 2, 3, 1).float().cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
    depth = depth.astype(np.float32)
    return dict(
        extrinsics=extrinsic.astype(np.float32), intrinsics=intrinsic.astype(np.float32),
        depth=depth, depth_conf=depth_conf.astype(np.float32),
        world_points=unproject(depth, extrinsic, intrinsic), images=imgs,
    )


def run_backend(image_paths: list[Path], backend: str = "vggt-omega", device: str | None = None) -> dict:
    """Run the model over ALL images (both captures) in one forward pass.

    Returns numpy arrays: extrinsics (S,3,4) cam-from-world OpenCV, intrinsics (S,3,3),
    depth (S,H,W), depth_conf (S,H,W), world_points (S,H,W,3), images (S,H,W,3) uint8.
    """
    import torch

    device = _device(device)
    paths = [str(p) for p in image_paths]

    if backend == "vggt-omega":
        from huggingface_hub import hf_hub_download
        from vggt_omega.models import VGGTOmega
        from vggt_omega.utils.load_fn import load_and_preprocess_images
        from vggt_omega.utils.pose_enc import encoding_to_camera

        ckpt = hf_hub_download(OMEGA_REPO, OMEGA_FILE, token=os.environ.get("HF_TOKEN"))
        model = VGGTOmega().to(device).eval()
        model.load_state_dict(torch.load(ckpt, map_location="cpu"))
        images = load_and_preprocess_images(paths, image_resolution=512).to(device)
        with torch.inference_mode(), _autocast(device):
            pred = model(images)
        extrinsic, intrinsic = encoding_to_camera(pred["pose_enc"], pred["images"].shape[-2:])
        depth = pred["depth"].float().cpu().numpy()
        depth = depth[0, ..., 0] if depth.ndim == 5 else depth[0]
        conf = pred["depth_conf"].float().cpu().numpy()
        conf = conf[0, ..., 0] if conf.ndim == 5 else conf[0]
        return _finish(pred["images"][0] if pred["images"].ndim == 5 else pred["images"],
                       extrinsic[0].float().cpu().numpy(), intrinsic[0].float().cpu().numpy(), depth, conf)

    if backend == "vggt":
        from vggt.models.vggt import VGGT
        from vggt.utils.load_fn import load_and_preprocess_images
        from vggt.utils.pose_enc import pose_encoding_to_extri_intri

        model = VGGT.from_pretrained("facebook/VGGT-1B").to(device).eval()
        images = load_and_preprocess_images(paths).to(device)
        with torch.inference_mode(), _autocast(device):
            pred = model(images)
        extrinsic, intrinsic = pose_encoding_to_extri_intri(pred["pose_enc"], images.shape[-2:])
        depth = pred["depth"][0, ..., 0].float().cpu().numpy()
        conf = pred["depth_conf"][0].float().cpu().numpy()
        return _finish(images, extrinsic[0].float().cpu().numpy(), intrinsic[0].float().cpu().numpy(), depth, conf)

    if backend == "pi3x":
        from pi3.models.pi3x import Pi3X
        from pi3.utils.basic import load_images_as_tensor

        model = Pi3X.from_pretrained("yyfz233/Pi3X").to(device).eval()
        # the loader takes a directory and sorts by name: stage copies with a zero-padded order prefix
        with tempfile.TemporaryDirectory() as td:
            for i, p in enumerate(paths):
                shutil.copy(p, Path(td) / f"{i:05d}{Path(p).suffix}")
            imgs = load_images_as_tensor(td, interval=1).to(device)
        with torch.no_grad(), _autocast(device):
            res = model(imgs[None])
        cam2world = res["camera_poses"][0].float().cpu().numpy()
        extrinsic = np.linalg.inv(cam2world)[:, :3, :]
        local = res["local_points"][0].float().cpu().numpy()
        conf = res["conf"][0].float().cpu().numpy()
        conf = conf[..., 0] if conf.ndim == 4 else conf
        depth = local[..., 2]
        intrinsic = res["intrinsics"][0].float().cpu().numpy() if "intrinsics" in res else _intrinsics_from_local_points(local)
        return _finish(imgs, extrinsic, intrinsic, depth, conf)

    raise ValueError(f"unknown backend {backend}; choose from {BACKENDS}")


def _intrinsics_from_local_points(local: np.ndarray) -> np.ndarray:
    """Least-squares pinhole fit per frame from camera-space points (for backends that give none)."""
    S, H, W, _ = local.shape
    vv, uu = np.mgrid[0:H, 0:W]
    out = np.zeros((S, 3, 3), np.float32)
    for s in range(S):
        p = local[s].reshape(-1, 3)
        ok = p[:, 2] > 1e-6
        x, y = p[ok, 0] / p[ok, 2], p[ok, 1] / p[ok, 2]
        fx, cx = np.linalg.lstsq(np.stack([x, np.ones_like(x)], 1), uu.reshape(-1)[ok], rcond=None)[0]
        fy, cy = np.linalg.lstsq(np.stack([y, np.ones_like(y)], 1), vv.reshape(-1)[ok], rcond=None)[0]
        out[s] = [[fx, 0, cx], [0, fy, cy], [0, 0, 1]]
    return out


def split_joint_output(out: dict, before_paths: list[Path], after_paths: list[Path]) -> tuple[Recon, Recon]:
    """The joint pass returns S = len(before)+len(after) frames in input order. Split them back."""
    nb = len(before_paths)

    def mk(capture, paths, sl):
        return Recon(capture=capture, frame_paths=list(paths), frame_ids=[p.stem for p in paths],
                     extrinsics=out["extrinsics"][sl], intrinsics=out["intrinsics"][sl], depth=out["depth"][sl],
                     depth_conf=out["depth_conf"][sl], world_points=out["world_points"][sl], colors=out["images"][sl])

    return mk("before", before_paths, slice(0, nb)), mk("after", after_paths, slice(nb, None))


def recon_to_cloud(r: Recon, conf_quantile: float = 0.3, stride: int = 2) -> tuple[np.ndarray, np.ndarray]:
    """Flatten a Recon to (N,3) points and (N,3) colours, dropping the lowest-confidence pixels."""
    conf = r.depth_conf[:, ::stride, ::stride]
    pts = r.world_points[:, ::stride, ::stride].reshape(-1, 3)
    col = r.colors[:, ::stride, ::stride].reshape(-1, 3)
    thr = np.quantile(conf, conf_quantile)
    keep = (conf.reshape(-1) >= thr) & np.isfinite(pts).all(1) & (r.depth[:, ::stride, ::stride].reshape(-1) > 1e-4)
    return pts[keep], col[keep]


def save_ply(path: Path, points: np.ndarray, colors: np.ndarray) -> None:
    import open3d as o3d

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points.astype(np.float64))
    pcd.colors = o3d.utility.Vector3dVector(colors.astype(np.float64) / 255.0)
    path.parent.mkdir(parents=True, exist_ok=True)
    o3d.io.write_point_cloud(str(path), pcd, write_ascii=False, compressed=False)
