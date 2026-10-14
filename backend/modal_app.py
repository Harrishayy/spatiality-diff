"""Modal app: the one GPU stage. Deploy once, then the CLI calls it.

    cd backend && modal deploy modal_app.py
    spatiality-diff run --before a.mp4 --after b.mp4 --out outputs/desk      # uses it by default

Cost: ~120 keyframes (both captures) through a 1B model is about a minute on an A100-40GB
including model load from the cached volume, i.e. a few cents per scene. The container
scales to zero between runs. Weights are cached in a Modal volume after the first run.

Secrets: the workspace secret `huggingface` (HF_TOKEN) is used for the gated VGGT-Omega
checkpoint; `vggt` and `pi3x` are open and need no token.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import modal

app = modal.App("spatiality-diff")
weights = modal.Volume.from_name("spatiality-diff-weights", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.6.0", "torchvision==0.21.0", "numpy<2", "pillow", "einops", "safetensors",
        "huggingface_hub", "opencv-python-headless", "scipy", "trimesh",
    )
    # three backends, three packages (vggt_omega, vggt, pi3): no name clash
    .pip_install("git+https://github.com/facebookresearch/vggt-omega.git")
    .pip_install("git+https://github.com/facebookresearch/vggt.git")
    .pip_install("git+https://github.com/yyfz/Pi3.git")
    .env({"HF_HOME": "/weights/hf", "HF_HUB_ENABLE_HF_TRANSFER": "0"})
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


@app.function(image=image, gpu="A100-40GB", timeout=10 * 60, volumes={"/weights": weights}, secrets=[modal.Secret.from_name("huggingface")])
def check_access() -> dict:
    """Which backends can load their weights with this workspace's secrets. Cheap: no forward pass."""
    import os

    from huggingface_hub import hf_hub_download

    out = {}
    try:
        hf_hub_download("facebook/VGGT-Omega", "vggt_omega_1b_512.pt", token=os.environ.get("HF_TOKEN"))
        out["vggt-omega"] = "ok"
    except Exception as e:  # noqa: BLE001
        out["vggt-omega"] = f"{type(e).__name__}: {str(e)[:160]}"
    for name, repo in (("vggt", "facebook/VGGT-1B"), ("pi3x", "yyfz233/Pi3X")):
        try:
            hf_hub_download(repo, "model.safetensors", token=os.environ.get("HF_TOKEN"))
            out[name] = "ok"
        except Exception as e:  # noqa: BLE001
            out[name] = f"{type(e).__name__}: {str(e)[:160]}"
    weights.commit()
    return out


@app.local_entrypoint()
def main(before_dir: str = "", after_dir: str = "", backend: str = "vggt", access: bool = False):
    """modal run modal_app.py --access            -> which weights this workspace can download
       modal run modal_app.py --before-dir X --after-dir Y --backend vggt   -> shapes of a joint pass"""
    import numpy as np

    if access or not before_dir:
        print(check_access.remote())
        return
    kb = sorted(Path(before_dir).glob("*.jpg"))
    ka = sorted(Path(after_dir).glob("*.jpg"))
    out = reconstruct.remote([(p.name, p.read_bytes()) for p in kb + ka], backend)
    print({k: np.asarray(v).shape for k, v in out.items()})
