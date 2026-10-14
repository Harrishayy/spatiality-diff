#!/usr/bin/env python
"""Render a scene's change survey plan to a PNG (the static form of the viewer's plan view).

    python scripts/render_plan.py outputs/synthetic_room docs/img/synthetic_plan.png

Same conventions as the viewer: room shaded by height, camera paths (before dashed, after solid),
added = solid outline with fill, removed = dashed + hatched, moved = both footprints + arrow + dimension,
unobserved = diagonal ticks, numbered callout balloons, scale bar.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import open3d as o3d  # noqa: E402
from matplotlib.patches import Circle, Polygon  # noqa: E402
from scipy.spatial import ConvexHull  # noqa: E402

INK, INK2, INK3, PAPER, GRID = "#16202b", "#4b5a6b", "#7a8896", "#f7f9fb", "#e3e8ee"
COL = {"added": "#0e8c7f", "removed": "#d9472b", "moved": "#6f4fd8", "unobserved": "#9aa4ae"}


def footprint(b):
    R, c, e = np.array(b["obb"]["rotation"]), np.array(b["obb"]["center"]), np.array(b["obb"]["extent"]) / 2
    corners = np.array([c + R @ (np.array([sx, sy, sz]) * e) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])[:, :2]
    return corners[ConvexHull(corners).vertices]


def main(scene: Path, out: Path):
    ch = json.loads((scene / "changes.json").read_text())
    cams = json.loads((scene / "cameras.json").read_text())
    after = np.asarray(o3d.io.read_point_cloud(str(scene / "after.ply")).points)
    unobs = np.asarray(o3d.io.read_point_cloud(str(scene / "before_unobserved.ply")).points) if (scene / "before_unobserved.ply").exists() else np.zeros((0, 3))
    fig, ax = plt.subplots(figsize=(12, 8), dpi=150)
    fig.patch.set_facecolor(PAPER); ax.set_facecolor(PAPER)
    z = np.clip(after[:, 2] / 2.2, 0, 1)
    ax.scatter(after[:, 0], after[:, 1], c=z, cmap=matplotlib.colors.LinearSegmentedColormap.from_list("h", ["#d6dde4", "#2a3744"]), s=1.2, linewidths=0, rasterized=True)
    if len(unobs):
        ax.plot(np.c_[unobs[:, 0] - .01, unobs[:, 0] + .01, np.full(len(unobs), np.nan)].ravel(), np.c_[unobs[:, 1] - .01, unobs[:, 1] + .01, np.full(len(unobs), np.nan)].ravel(), color=COL["unobserved"], lw=.6)
    for k, ls, col in (("before", "--", INK3), ("after", "-", INK2)):
        eyes = np.array([-(np.array(c["cam_from_world"])[:, :3].T @ np.array(c["cam_from_world"])[:, 3]) for c in cams[k]])
        ax.plot(eyes[:, 0], eyes[:, 1], ls, color=col, lw=.9)
        for c, e in list(zip(cams[k], eyes))[::3]:
            f = np.array(c["cam_from_world"])[2, :2]; ax.annotate("", xy=e[:2] + f * .09, xytext=e[:2], arrowprops=dict(arrowstyle="-|>", color=col, lw=.8, mutation_scale=8))
    for n, c in enumerate(ch["changes"], 1):
        col = COL[c["state"]]
        if c.get("before"):
            fp = footprint(c["before"])
            ax.add_patch(Polygon(fp, closed=True, fill=c["state"] == "removed", facecolor="none", hatch="////" if c["state"] == "removed" else None, edgecolor=col if c["state"] == "removed" else COL["removed"], lw=1.3, ls=(0, (5, 4)) if c["state"] == "removed" else (0, (2, 3))))
        if c.get("after"):
            fp = footprint(c["after"]); ax.add_patch(Polygon(fp, closed=True, facecolor=col, alpha=.28, edgecolor="none")); ax.add_patch(Polygon(fp, closed=True, fill=False, edgecolor=col, lw=1.3))
        if c["state"] == "moved":
            a, b = np.array(c["before"]["centroid"][:2]), np.array(c["after"]["centroid"][:2])
            ax.annotate("", xy=b, xytext=a, arrowprops=dict(arrowstyle="-|>", color=col, lw=1.4, mutation_scale=12))
            d = b - a; nrm = np.array([-d[1], d[0]]) / (np.linalg.norm(d) + 1e-9) * .28; a2, b2 = a + nrm, b + nrm
            for p, q in ((a, a2 + nrm * .2), (b, b2 + nrm * .2)): ax.plot([p[0], q[0]], [p[1], q[1]], color=INK, lw=.8)
            ax.annotate("", xy=b2, xytext=a2, arrowprops=dict(arrowstyle="<|-|>", color=INK, lw=.8, mutation_scale=9))
            m = (a2 + b2) / 2; ang = np.degrees(np.arctan2(d[1], d[0])); ang = ang + 180 if ang > 90 or ang < -90 else ang
            ax.text(m[0], m[1] + .05, f"{c['displacement_m']:.2f} m", ha="center", va="bottom", rotation=ang, rotation_mode="anchor", fontsize=8, family="monospace", color=INK, bbox=dict(facecolor=PAPER, edgecolor="none", pad=1.5))
        fp = footprint(c["after"] if c.get("after") else c["before"]); ctr = fp.mean(0); r = np.max(np.linalg.norm(fp - ctr, axis=1)); at = ctr + (r + .32) * .7071
        ax.plot([ctr[0], at[0]], [ctr[1], at[1]], color=INK, lw=.8); ax.add_patch(Circle(at, .11, facecolor=PAPER, edgecolor=INK, lw=1.3, zorder=5))
        ax.text(at[0], at[1], str(n), ha="center", va="center", fontsize=9, weight="bold", color=INK, zorder=6)
    ax.set_aspect("equal"); ax.grid(True, color=GRID, lw=.6); ax.set_axisbelow(True)
    for s in ax.spines.values(): s.set_edgecolor(INK); s.set_linewidth(1.2)
    ax.tick_params(labelsize=7, colors=INK2); ax.set_xlabel("x (m)", fontsize=8, color=INK2); ax.set_ylabel("y (m)", fontsize=8, color=INK2)
    x0, y0 = ax.get_xlim()[0] + .25, ax.get_ylim()[0] + .25
    ax.plot([x0, x0 + 1], [y0, y0], color=INK, lw=1.5); ax.text(x0 + .5, y0 + .05, "1 m", ha="center", fontsize=7, family="monospace", color=INK)
    cov = ch["coverage"]; cnt = ch["counts"]
    ax.set_title(f"{ch['scene']}  —  change survey, plan   ·   {sum(cnt.values())} findings   ·   coverage {cov:.2f} of before scene", fontsize=10, color=INK, loc="left", pad=10)
    for i, c in enumerate(ch["changes"], 1):
        ax.text(1.01, 0.98 - (i - 1) * .055, f"{i}  {c['sentence']}", transform=ax.transAxes, fontsize=8, color=INK, va="top")
    out.parent.mkdir(parents=True, exist_ok=True); fig.savefig(out, bbox_inches="tight", facecolor=PAPER); print("wrote", out)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else Path(sys.argv[1]) / "plan.png")
