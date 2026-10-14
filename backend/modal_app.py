"""Modal app: the one GPU stage. Deploy once, then the CLI calls it.

    modal deploy backend/modal_app.py
    spatiality-diff run --before a.mp4 --after b.mp4 --out outputs/desk      # uses it by default

Cost: ~120 keyframes (both captures) through VGGT-Omega 1B is ~1 min on an A100-40GB
including model load from the cached volume, i.e. a few cents per scene. The container
scales to zero between runs. First run downloads weights into the volume (~5 GB, once).

Secrets expected in the Modal workspace: `huggingface` with HF_TOKEN (VGGT-Omega is gated).
"""

from __future__ import annotations

import io
import tempfile
from pathlib import Path

import modal

app = modal.App("spatiality-diff")
weights = modal.Volume.from_name("spatiality-diff-weights", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.5.1", "torchvision==0.20.1", "numpy<2", "pillow", "einops", "safetensors",
        "huggingface_hub", "opencv-python-headless", "trimesh", "scipy",
    )
    # VGGT-Omega keeps VGGT's package layout; the original VGGT repo is the fallback backend.
    .pip_install("git+https://github.com/facebookresearch/vggt-omega.git")
    .pip_install("git+https://github.com/yyfz/Pi3.git")
    .env({"HF_HOME": "/weights/hf"})
    .add_local_python_source("spatiality_diff")
)


@app.function(
    image=image,
    gpu="A100-40GB",
    timeout=20 * 60,
    volumes={"/weights": weights},
    secrets=[modal.Secret.from_name("huggingface")],
)
def reconstruct(frames: list[tuple[str, bytes]], backend: str = "vggt-omega") -> dict:
    """frames: [(name, jpeg bytes)] for BOTH captures in order (before..., after...). Returns numpy dict."""
    from spatiality_diff.recon import run_backend

    with tempfile.TemporaryDirectory() as td:
        paths = []
        for name, data in frames:
            p = Path(td) / name
            p.write_bytes(data)
            paths.append(p)
        out = run_backend(paths, backend=backend, device="cuda")
    weights.commit()
    return out


@app.local_entrypoint()
def main(before_dir: str, after_dir: str, backend: str = "vggt-omega"):
    """Direct test: modal run backend/modal_app.py --before-dir outputs/x/work/before/keyframes --after-dir ..."""
    import numpy as np

    kb = sorted(Path(before_dir).glob("*.jpg"))
    ka = sorted(Path(after_dir).glob("*.jpg"))
    out = reconstruct.remote([(p.name, p.read_bytes()) for p in kb + ka], backend)
    print({k: np.asarray(v).shape for k, v in out.items()})
