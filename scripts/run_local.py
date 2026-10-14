#!/usr/bin/env python
"""Local reconstruction (CUDA or Apple MPS) instead of Modal.

    uv pip install -e "backend[gpu]"
    pip install git+https://github.com/facebookresearch/vggt-omega.git   # or .../vggt.git, .../Pi3.git
    python scripts/run_local.py outputs/desk --backend vggt-omega

Writes work/recon_{before,after}.npz, after which `spatiality-diff run ... --compute local`
finds them cached and skips the GPU step. On an M-series Mac with 32 GB, 2 x 40 frames at 518px
takes a few minutes in float32 on MPS; use --frames-per-video 40 when preparing frames.
Not smoke-tested here: Modal is the path this project is built against.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from spatiality_diff.recon import run_backend, split_joint_output


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scene_dir", type=Path, help="outputs/<scene>, with work/{before,after}/keyframes already extracted")
    ap.add_argument("--backend", default="vggt-omega")
    ap.add_argument("--device", default=None, help="cuda | mps | cpu (auto)")
    a = ap.parse_args()
    work = a.scene_dir / "work"
    kb = sorted((work / "before" / "keyframes").glob("*.jpg"))
    ka = sorted((work / "after" / "keyframes").glob("*.jpg"))
    out = run_backend(kb + ka, backend=a.backend, device=a.device)
    rb, ra = split_joint_output(out, kb, ka)
    rb.save(work / "recon_before.npz")
    ra.save(work / "recon_after.npz")
    print("saved", work / "recon_before.npz", work / "recon_after.npz")


if __name__ == "__main__":
    main()
