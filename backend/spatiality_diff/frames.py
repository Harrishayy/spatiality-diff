"""Stage 1: video -> keyframes. CPU only.

Cost note: every keyframe costs GPU seconds in the reconstruction pass, so this
stage is where most of the money is saved. Defaults give ~60 frames per video,
which is plenty for a small room and keeps a joint pass of both captures under
~2 minutes on an A100.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np


def extract_all(video: Path, out_dir: Path, fps: float = 4.0, max_side: int = 1024) -> list[Path]:
    """Extract frames at `fps`, downscaled so the long side is `max_side`."""
    out_dir.mkdir(parents=True, exist_ok=True)
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found on PATH")
    vf = f"fps={fps},scale='if(gt(iw,ih),{max_side},-2)':'if(gt(iw,ih),-2,{max_side})'"
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(video), "-vf", vf, "-q:v", "2", str(out_dir / "%05d.jpg")]
    subprocess.run(cmd, check=True)
    return sorted(out_dir.glob("*.jpg"))


def blur_score(path: Path) -> float:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0
    return float(cv2.Laplacian(img, cv2.CV_64F).var())


def select_keyframes(frames: list[Path], target: int = 60, drop_blurriest: float = 0.2) -> list[Path]:
    """Drop the blurriest `drop_blurriest` fraction, then pick `target` frames spread evenly in time.

    Even temporal spread beats "sharpest N": the reconstruction needs coverage
    of the whole sweep more than it needs perfectly sharp frames.
    """
    if not frames:
        return []
    scores = np.array([blur_score(f) for f in frames])
    keep = scores >= np.quantile(scores, drop_blurriest) if len(frames) > 10 else np.ones(len(frames), bool)
    kept = [f for f, k in zip(frames, keep) if k]
    if len(kept) <= target:
        return kept
    idx = np.linspace(0, len(kept) - 1, target).round().astype(int)
    return [kept[i] for i in sorted(set(idx.tolist()))]


def prepare_capture(video: Path, work_dir: Path, target: int = 60, fps: float = 4.0) -> list[Path]:
    """video -> work_dir/all/*.jpg -> work_dir/keyframes/<id>.jpg (copied, so ids are stable)."""
    all_frames = extract_all(video, work_dir / "all", fps=fps)
    chosen = select_keyframes(all_frames, target=target)
    key_dir = work_dir / "keyframes"
    key_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for f in chosen:
        dst = key_dir / f.name  # keep the original index as the frame id
        if not dst.exists():
            shutil.copy2(f, dst)
        out.append(dst)
    return out
