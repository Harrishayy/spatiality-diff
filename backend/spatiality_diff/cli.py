"""spatiality-diff CLI. Stages are cached: re-running skips anything whose output exists."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import numpy as np
import typer
from dotenv import load_dotenv

from . import frames as F
from .geometry import apply_transform, compose_extrinsic
from .contracts import Change, Recon

app = typer.Typer(add_completion=False, help="What changed in the room?")
load_dotenv()


@app.callback()
def _root():
    """spatiality-diff: two phone videos of a room -> a change survey (`run`)."""


def _log(stage: str, t0: float):
    typer.echo(f"[{stage}] {time.time() - t0:6.1f}s")


@app.command()
def run(
    before: Path = typer.Option(..., help="Phone video of the room, first recording"),
    after: Path = typer.Option(..., help="Phone video of the room, second recording"),
    out: Path = typer.Option(..., help="Output folder, e.g. outputs/desk"),
    frames_per_video: int = typer.Option(60, help="Keyframes per capture. Fewer = cheaper GPU pass."),
    backend: str = typer.Option("vggt-omega", help="vggt-omega | vggt | pi3x"),
    compute: str = typer.Option("modal", help="modal | local"),
    label: bool = typer.Option(True, help="Call the VLM to label blobs (needs GEMINI_API_KEY)."),
    scale_m: float = typer.Option(0.0, help="Metres per model unit if known; 0 = report in model units."),
):
    """Full pipeline: frames -> joint reconstruction -> background refine -> visibility diff -> labels -> report."""
    out.mkdir(parents=True, exist_ok=True)
    work = out / "work"
    t0 = time.time()

    # 1. frames
    kb = F.prepare_capture(before, work / "before", target=frames_per_video)
    ka = F.prepare_capture(after, work / "after", target=frames_per_video)
    _log(f"frames  before={len(kb)} after={len(ka)}", t0)

    # 2. joint reconstruction (cached)
    rb_path, ra_path = work / "recon_before.npz", work / "recon_after.npz"
    if not (rb_path.exists() and ra_path.exists()):
        if compute == "modal":
            from .modal_client import reconstruct_remote
            rb, ra = reconstruct_remote(kb, ka, backend=backend)
        else:
            from .recon import run_backend, split_joint_output
            rb, ra = split_joint_output(run_backend(kb + ka, backend=backend), kb, ka)
        rb.save(rb_path)
        ra.save(ra_path)
    rb, ra = Recon.load(rb_path), Recon.load(ra_path)
    _log(f"recon   backend={backend} on {compute}", t0)

    # 3. refine the shared frame on the static background
    from .recon import recon_to_cloud
    from .register import refine_alignment
    bp, _ = recon_to_cloud(rb)
    ap, _ = recon_to_cloud(ra)
    T, rmse = refine_alignment(bp, ap)
    ra.world_points = apply_transform(ra.world_points.reshape(-1, 3), T).reshape(ra.world_points.shape).astype(np.float32)
    ra.extrinsics = np.stack([compose_extrinsic(E, T) for E in ra.extrinsics]).astype(np.float32)
    _log(f"register rmse={rmse:.4f}", t0)

    # 4. diff
    from .diff import run_diff
    d = run_diff(rb, ra)
    _log(f"diff    removed={len(d['removed'])} added={len(d['added'])} pairs={len(d['pairs'])} coverage={d['coverage']:.2f}", t0)

    # 5. changes + labels + evidence crops
    from . import label as L
    changes: list[Change] = []
    paired_r = {i for i, _, _ in d["pairs"]}
    paired_a = {j for _, j, _ in d["pairs"]}
    ev_dir = out / "evidence"
    unit = scale_m if scale_m > 0 else 1.0

    def evidence(c: Change):
        ev = {}
        if c.before_blob is not None:
            b = c.before_blob
            p, box = L.crop_with_box(rb, b.best_frame_self, b, ev_dir / f"{c.id}_before.jpg")
            ev["before"] = dict(frame_id=rb.frame_ids[b.best_frame_self], crop=f"evidence/{p.name}", box=box)
            if c.after_blob is None:  # removed: show the empty location in the after capture
                p2, box2 = L.crop_location(ra, b.best_frame_other, b, ev_dir / f"{c.id}_after.jpg")
                ev["after"] = dict(frame_id=ra.frame_ids[b.best_frame_other], crop=f"evidence/{p2.name}", box=box2)
        if c.after_blob is not None:
            a = c.after_blob
            p, box = L.crop_with_box(ra, a.best_frame_self, a, ev_dir / f"{c.id}_after.jpg")
            ev["after"] = dict(frame_id=ra.frame_ids[a.best_frame_self], crop=f"evidence/{p.name}", box=box)
            if c.before_blob is None:  # added: show the empty location in the before capture
                p2, box2 = L.crop_location(rb, a.best_frame_other, a, ev_dir / f"{c.id}_before.jpg")
                ev["before"] = dict(frame_id=rb.frame_ids[a.best_frame_other], crop=f"evidence/{p2.name}", box=box2)
        return ev

    def support_conf(b):
        return float(np.clip(b.support_free / max(b.support_total, 1), 0, 1)) * float(np.clip(b.support_total / 6, 0, 1))

    for i, j, score in d["pairs"]:
        r, a = d["removed"][i], d["added"][j]
        c = Change(id=f"m{len(changes):02d}", state="moved", before_blob=r, after_blob=a,
                   displacement_m=float(np.linalg.norm(a.centroid - r.centroid)) * unit,
                   confidence=0.5 * (support_conf(r) + support_conf(a)))
        c.evidence = evidence(c)
        changes.append(c)
    for i, r in enumerate(d["removed"]):
        if i in paired_r:
            continue
        c = Change(id=f"r{len(changes):02d}", state="removed", before_blob=r, confidence=support_conf(r))
        c.evidence = evidence(c)
        changes.append(c)
    for j, a in enumerate(d["added"]):
        if j in paired_a:
            continue
        c = Change(id=f"a{len(changes):02d}", state="added", after_blob=a, confidence=support_conf(a))
        c.evidence = evidence(c)
        changes.append(c)

    summary = ""
    if label and os.environ.get("GEMINI_API_KEY"):
        kept = []
        for c in changes:
            if c.state == "moved":
                po = L.label_pair(ev_dir / f"{c.id}_before.jpg", ev_dir / f"{c.id}_after.jpg")
                if not po.same_object:
                    # VLM vetoes the pairing: split into removed + added
                    r = Change(id=c.id + "r", state="removed", before_blob=c.before_blob, confidence=support_conf(c.before_blob))
                    a = Change(id=c.id + "a", state="added", after_blob=c.after_blob, confidence=support_conf(c.after_blob))
                    for x in (r, a):
                        x.evidence = evidence(x)
                        lo = L.label_blob(ev_dir / f"{x.id}_{'before' if x.state == 'removed' else 'after'}.jpg", x.state)
                        x.label, x.confidence = lo.label, x.confidence * (0.5 + 0.5 * lo.confidence)
                        x.description = L.sentence(x)
                        if lo.is_object:
                            kept.append(x)
                    continue
                c.label = po.label
                c.confidence *= 0.5 + 0.5 * po.confidence
            else:
                lo = L.label_blob(ev_dir / f"{c.id}_{'before' if c.state == 'removed' else 'after'}.jpg", c.state)
                if not lo.is_object:
                    continue
                c.label = lo.label
                c.confidence *= 0.5 + 0.5 * lo.confidence
            c.description = L.sentence(c)
            kept.append(c)
        changes = kept
        summary = L.summarize(changes, d["coverage"])
        _log(f"label   {len(changes)} changes via {L.DEFAULT_MODEL}", t0)
    else:
        for c in changes:
            c.description = L.sentence(c)
        summary = f"{len(changes)} change regions detected; labelling skipped (no GEMINI_API_KEY)."

    changes.sort(key=lambda c: -c.confidence)

    # 6. report
    from .report import write_outputs
    meta = dict(scene=out.name, units="m" if scale_m > 0 else "model", backend=backend, compute=compute,
                frames=dict(before=len(kb), after=len(ka)), register_rmse=rmse, seconds=round(time.time() - t0, 1))
    p = write_outputs(out, rb, ra, d, changes, summary, meta)
    _log("report", t0)
    typer.echo(json.dumps(dict(changes=p.as_posix(), counts=json.loads(p.read_text())["counts"], coverage=d["coverage"]), indent=1))


if __name__ == "__main__":
    app()
