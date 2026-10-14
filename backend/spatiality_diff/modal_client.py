"""Laptop side of the Modal path: ship keyframes up, get the joint reconstruction back."""

from __future__ import annotations

from pathlib import Path

from .recon import split_joint_output
from .contracts import Recon


def reconstruct_remote(before: list[Path], after: list[Path], backend: str = "vggt-omega") -> tuple[Recon, Recon]:
    import modal

    fn = modal.Function.from_name("spatiality-diff", "reconstruct")
    payload = [(p.name, p.read_bytes()) for p in before] + [(p.name, p.read_bytes()) for p in after]
    out = fn.remote(payload, backend)
    return split_joint_output(out, before, after)
