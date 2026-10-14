"""Stage 5: name each change blob and write the sentence. The only paid stage.

Cost control: we label ONLY the diff blobs (typically 2-6 per scene), one VLM
call each on a cropped frame, plus one call for the scene summary. With
Gemini 2.5 Flash-Lite that is well under a cent per scene. The whole-scene
segmentation stack from spatiality_v2 is deliberately absent.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from pydantic import BaseModel, Field

from .geometry import project
from .contracts import Blob, Change, Recon

DEFAULT_MODEL = os.environ.get("SPATIALITY_VLM_MODEL", "gemini-2.5-flash-lite")


class LabelOut(BaseModel):
    label: str = Field(description="Short noun phrase for the object inside the highlighted box, e.g. 'office chair'. 'unknown object' if unclear.")
    confidence: float = Field(ge=0, le=1, description="How sure you are of the label.")
    is_object: bool = Field(description="False if the box covers floor, wall, shadow, reflection or empty space rather than a physical object.")


class PairOut(BaseModel):
    same_object: bool = Field(description="True if both boxes show the same physical object in two positions.")
    label: str
    confidence: float = Field(ge=0, le=1)


class SummaryOut(BaseModel):
    summary: str = Field(description="Two or three plain sentences describing what changed in the room, past tense, no hedging.")


def _agent(output_type):
    from pydantic_ai import Agent

    model = DEFAULT_MODEL
    if not model.startswith(("google-gla:", "gemini")):
        return Agent(model, output_type=output_type)
    return Agent(f"google-gla:{model.removeprefix('google-gla:')}", output_type=output_type)


def crop_with_box(recon: Recon, frame_idx: int, blob: Blob, out_path: Path, color=(245, 196, 81), margin: float = 0.35) -> tuple[Path, tuple[int, int, int, int]]:
    """Draw the blob's projected bounding box on its best frame and save a context crop. Returns (path, box_px in full frame)."""
    uv, z = project(blob.points, recon.extrinsics[frame_idx], recon.intrinsics[frame_idx])
    h, w = recon.hw
    ok = (z > 0) & (uv[:, 0] >= 0) & (uv[:, 0] < w) & (uv[:, 1] >= 0) & (uv[:, 1] < h)
    if ok.sum() < 5:
        x0, y0, x1, y1 = 0, 0, w - 1, h - 1
    else:
        x0, y0 = np.percentile(uv[ok], 2, axis=0).astype(int)
        x1, y1 = np.percentile(uv[ok], 98, axis=0).astype(int)
    img = Image.fromarray(recon.colors[frame_idx]).convert("RGB")
    d = ImageDraw.Draw(img)
    d.rectangle([x0, y0, x1, y1], outline=color, width=3)
    mw, mh = int((x1 - x0) * margin + 20), int((y1 - y0) * margin + 20)
    crop = img.crop((max(0, x0 - mw), max(0, y0 - mh), min(w, x1 + mw), min(h, y1 + mh)))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    crop.save(out_path, quality=90)
    return out_path, (int(x0), int(y0), int(x1), int(y1))


def crop_location(recon: Recon, frame_idx: int, blob: Blob, out_path: Path, color=(255, 93, 74)) -> tuple[Path, tuple[int, int, int, int]]:
    """Same box, drawn dashed-style on the OTHER capture's frame: the free-space evidence for a removed object."""
    return crop_with_box(recon, frame_idx, blob, out_path, color=color)


def label_blob(crop_path: Path, state: str) -> LabelOut:
    from pydantic_ai import BinaryContent

    agent = _agent(LabelOut)
    prompt = (
        f"This frame is from a phone video of a room. The highlighted box marks a region that was {state} "
        "between two recordings. Name the physical object inside the box."
    )
    res = agent.run_sync([prompt, BinaryContent(data=crop_path.read_bytes(), media_type="image/jpeg")])
    return res.output


def label_pair(before_crop: Path, after_crop: Path) -> PairOut:
    from pydantic_ai import BinaryContent

    agent = _agent(PairOut)
    res = agent.run_sync([
        "Two frames of the same room from two recordings. First image: an object that disappeared from the highlighted location. "
        "Second image: an object that appeared at the highlighted location. Is it the same physical object, moved?",
        BinaryContent(data=before_crop.read_bytes(), media_type="image/jpeg"),
        BinaryContent(data=after_crop.read_bytes(), media_type="image/jpeg"),
    ])
    return res.output


def summarize(changes: list[Change], coverage: float) -> str:
    agent = _agent(SummaryOut)
    lines = [f"- {c.state}: {c.label}" + (f", moved {c.displacement_m:.2f} m" if c.displacement_m else "") for c in changes]
    res = agent.run_sync(
        "Write the summary for a robot's change report. Detected changes:\n" + "\n".join(lines) +
        f"\nThe second recording observed {coverage:.0%} of the first scene; the rest is unobserved, not unchanged."
    )
    return res.output.summary


def sentence(c: Change) -> str:
    lbl = c.label[0].upper() + c.label[1:]
    if c.state == "moved" and c.displacement_m is not None:
        return f"{lbl} moved {c.displacement_m:.2f} m"
    if c.state == "added":
        return f"{lbl} added"
    return f"{lbl} removed"
