#!/usr/bin/env python
"""Build outputs/synthetic_room from the synthetic scene so the viewer and the non-GPU stages can be exercised
without a phone video or a GPU:   python scripts/make_demo.py && cd web && pnpm dev -> /scenes/synthetic_room"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
import numpy as np

from spatiality_diff import label as L
from spatiality_diff.contracts import Change
from spatiality_diff.diff import run_diff
from spatiality_diff.report import write_outputs
from synthetic import scene_pair

out = Path("outputs/synthetic_room")
before, after, truth = scene_pair(out / "work")
d = run_diff(before, after, voxel=0.03, min_free=2)
names = {"before": {}, "after": {}}
changes = []
ev = out / "evidence"
for i, j, s in d["pairs"]:
    r, a = d["removed"][i], d["added"][j]
    c = Change(id=f"m{len(changes):02d}", state="moved", label="chair", before_blob=r, after_blob=a,
               displacement_m=float(np.linalg.norm(a.centroid - r.centroid)), confidence=0.9)
    L.crop_with_box(before, r.best_frame_self, r, ev / f"{c.id}_before.jpg"); L.crop_with_box(after, a.best_frame_self, a, ev / f"{c.id}_after.jpg")
    c.evidence = dict(before=dict(frame_id=before.frame_ids[r.best_frame_self], crop=f"evidence/{c.id}_before.jpg"), after=dict(frame_id=after.frame_ids[a.best_frame_self], crop=f"evidence/{c.id}_after.jpg"))
    c.description = L.sentence(c); changes.append(c)
paired_r = {i for i, _, _ in d["pairs"]}; paired_a = {j for _, j, _ in d["pairs"]}
for i, r in enumerate(d["removed"]):
    if i in paired_r: continue
    c = Change(id=f"r{len(changes):02d}", state="removed", label="floor lamp", before_blob=r, confidence=0.8)
    L.crop_with_box(before, r.best_frame_self, r, ev / f"{c.id}_before.jpg"); L.crop_location(after, r.best_frame_other, r, ev / f"{c.id}_after.jpg")
    c.evidence = dict(before=dict(frame_id=before.frame_ids[r.best_frame_self], crop=f"evidence/{c.id}_before.jpg"), after=dict(frame_id=after.frame_ids[r.best_frame_other], crop=f"evidence/{c.id}_after.jpg"))
    c.description = L.sentence(c); changes.append(c)
for j, a in enumerate(d["added"]):
    if j in paired_a: continue
    c = Change(id=f"a{len(changes):02d}", state="added", label="cardboard box", after_blob=a, confidence=0.85)
    L.crop_location(before, a.best_frame_other, a, ev / f"{c.id}_before.jpg"); L.crop_with_box(after, a.best_frame_self, a, ev / f"{c.id}_after.jpg")
    c.evidence = dict(before=dict(frame_id=before.frame_ids[a.best_frame_other], crop=f"evidence/{c.id}_before.jpg"), after=dict(frame_id=after.frame_ids[a.best_frame_self], crop=f"evidence/{c.id}_after.jpg"))
    c.description = L.sentence(c); changes.append(c)
summary = "The chair moved about 0.8 m along the wall, the floor lamp was removed from the corner, and a box was added on the desk."
p = write_outputs(out, before, after, d, changes, summary, dict(scene="synthetic_room", units="m", backend="synthetic", compute="cpu"))
print("wrote", p, "truth:", truth)
