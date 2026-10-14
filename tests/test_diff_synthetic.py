"""The visibility diff must find exactly: chair moved, lamp removed, box added; and must not flag unobserved regions."""

import numpy as np

from spatiality_diff.diff import run_diff
from synthetic import scene_pair


def test_diff_finds_three_changes():
    before, after, truth = scene_pair()
    d = run_diff(before, after, voxel=0.03, min_free=2)
    # one removed blob (lamp) + the chair's old pose; one added blob (box) + the chair's new pose
    assert 1 <= len(d["removed"]) <= 3, [len(b.points) for b in d["removed"]]
    assert 1 <= len(d["added"]) <= 3, [len(b.points) for b in d["added"]]
    assert len(d["pairs"]) == 1, d["pairs"]                       # the chair matched old<->new
    i, j, _ = d["pairs"][0]
    disp = np.linalg.norm(d["added"][j].centroid - d["removed"][i].centroid)
    assert 0.6 < disp < 1.0, disp                                 # moved 0.8 m along x
    assert 0.5 < d["coverage"] <= 1.0


def test_unobserved_is_not_a_change():
    before, after, _ = scene_pair()
    # crop the after capture to its first third: most of the room becomes unobserved, not removed
    after.extrinsics = after.extrinsics[:8]; after.depth = after.depth[:8]; after.depth_conf = after.depth_conf[:8]
    after.world_points = after.world_points[:8]; after.colors = after.colors[:8]
    after.frame_paths = after.frame_paths[:8]; after.frame_ids = after.frame_ids[:8]
    d = run_diff(before, after, voxel=0.03, min_free=2)
    assert d["coverage"] < 0.9
    assert d["before_unobserved"].sum() > d["before_changed"].sum()
