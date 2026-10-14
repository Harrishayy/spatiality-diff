"""Stage 6: write the viewer payload and the human report.

outputs/<scene>/
  before.ply, after.ply         coloured clouds in the shared frame (viewer)
  states.json                   per-point state arrays are too big for JSON: we export per-blob plys instead
  blobs/<change_id>_{before,after}.ply
  cameras.json                  per-frame K, cam-from-world for both captures
  changes.json                  THE artefact: what changed, where, how sure, evidence
  evidence/<change_id>_{before,after}.jpg
  summary.md
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .recon import save_ply
from .contracts import Change, Recon


def _cam_list(r: Recon):
    return [
        dict(frame_id=fid, path=str(p.name), K=r.intrinsics[i].round(3).tolist(), cam_from_world=r.extrinsics[i].round(5).tolist())
        for i, (fid, p) in enumerate(zip(r.frame_ids, r.frame_paths))
    ]


def _blob_json(b, out: Path, change_id: str, which: str):
    save_ply(out / "blobs" / f"{change_id}_{which}.ply", b.points, b.colors)
    return dict(
        ply=f"blobs/{change_id}_{which}.ply",
        n_points=int(len(b.points)),
        centroid=b.centroid.round(4).tolist(),
        obb=dict(center=b.obb_center.round(4).tolist(), extent=b.obb_extent.round(4).tolist(), rotation=b.obb_rotation.round(5).tolist()),
        support=dict(free=b.support_free, looked=b.support_total),
        best_frame_self=b.best_frame_self,
        best_frame_other=b.best_frame_other,
    )


def write_outputs(out: Path, before: Recon, after: Recon, diff: dict, changes: list[Change], summary: str, meta: dict) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    save_ply(out / "before.ply", diff["before_points"], diff["before_colors"])
    save_ply(out / "after.ply", diff["after_points"], diff["after_colors"])
    # unobserved before-points, so the viewer can hatch them
    ub = diff["before_unobserved"]
    save_ply(out / "before_unobserved.ply", diff["before_points"][ub], diff["before_colors"][ub])
    (out / "cameras.json").write_text(json.dumps(dict(before=_cam_list(before), after=_cam_list(after)), indent=1))

    items = []
    for c in changes:
        d = dict(id=c.id, state=c.state, label=c.label, sentence=c.description, confidence=round(c.confidence, 3), evidence=c.evidence)
        if c.before_blob is not None:
            d["before"] = _blob_json(c.before_blob, out, c.id, "before")
        if c.after_blob is not None:
            d["after"] = _blob_json(c.after_blob, out, c.id, "after")
        if c.displacement_m is not None:
            d["displacement_m"] = round(float(c.displacement_m), 3)
        if c.rotation_deg is not None:
            d["rotation_deg"] = round(float(c.rotation_deg), 1)
        items.append(d)
    payload = dict(
        scene=meta.get("scene"),
        units=meta.get("units", "model"),
        coverage=round(float(diff["coverage"]), 4),
        counts={s: sum(1 for c in changes if c.state == s) for s in ("added", "removed", "moved")},
        summary=summary,
        changes=items,
        pipeline=meta,
    )
    (out / "changes.json").write_text(json.dumps(payload, indent=1))

    md = [f"# {meta.get('scene', 'scene')}: what changed", "", summary, "",
          f"Coverage: {payload['coverage']:.0%} of the before scene was observed by the after capture.", ""]
    for c in changes:
        md.append(f"- **{c.state.upper()}** {c.description} (confidence {c.confidence:.2f})")
    (out / "summary.md").write_text("\n".join(md) + "\n")
    return out / "changes.json"
