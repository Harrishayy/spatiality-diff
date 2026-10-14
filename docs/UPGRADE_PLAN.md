# Robustness upgrade plan

Survey done on 2026-10-14 against the pipeline's known weak points. Each item says what the evidence supports,
how it plugs into the current code, what it costs, and the pitfalls. Effort: S under a day, M a few days, L a week+.
Preprints from 2026 are unreviewed; treat their numbers as indicative.

## Priority order

| # | Upgrade | Fixes | Expected gain | Effort |
|---|---|---|---|---|
| 1 | Metric scale from MoGe-2 (fallback DA3-Metric) by median depth-ratio fit | model units | metres with ~5–10% error, <2 s | S |
| 2 | Hybrid registration (VGGT-CD recipe): dense pass per capture + small joint keyframe pass + Umeyama Sim(3) + static purification | joint-pass smearing | indoor ATE 0.14 m vs 0.33 m reported; removes the biggest failure mode | M |
| 3 | Per-scene null-calibrated tolerance + log-odds free-space accumulation | hand-set 3 cm + 4% and vote counting | principled false-positive control | M |
| 4 | SAM-mask lifting to define blob extents; minAreaRect footprints on gravity-aligned XY | DBSCAN under/over-segmentation, loose OBBs | tight object blobs and plan footprints | M |
| 5 | DINOv3 mask-pooled descriptors + Kabsch/ICP verification for moved pairs | extent + colour matching | robust to lighting and viewpoint, gives the move's rotation | S |
| 6 | Lighting-nuisance guard: DINOv3 consistency veto + thin-on-plane filter + VLM change class | screens, curtains, shadows reported as geometry | fewer false alarms | S |
| 7 | PASLCD harness: render changes.json to per-view masks, mIoU / F1 | no benchmark | a number to compare against GS-Pool 0.751 | M |
| 8 | Labels: 3 crops + majority vote + metric dims in prompt; SAM 3.1 text prompt as second opinion; Qwen3-VL-8B local option | single-crop VLM mislabels | fewer confident wrong labels | S |
| 9 | Frame selection: blur gate relative to neighbours + 60–80% overlap band; 100–150 frames at the 512 checkpoint | fixed stride | better coverage per GPU second | S |

Rule from the calibration literature: never use the model's `depth_conf` as a metre tolerance. Use it to rank and gate.

## 1. Metric scale

VGGT-Ω outputs `depth`, `depth_conf`, `pose_enc` with no metric claim ([repo](https://github.com/facebookresearch/vggt-omega));
treat it as normalised like VGGT. Candidates for recovering metres:

- **MoGe-2** (Microsoft, MIT, Jul 2025): metric point maps, ~60 ms per image on an A100; reported 8.19 relative point
  error against 10.1 for UniDepthV2 under translation-only alignment ([arXiv 2507.02546](https://arxiv.org/abs/2507.02546),
  [repo](https://github.com/microsoft/moge)).
- **DA3-Metric-Large** (0.35B, Apache-2.0): `metric_depth = focal_px * net / 300`, needs intrinsics, which VGGT-Ω gives
  ([repo](https://github.com/ByteDance-Seed/Depth-Anything-3)). Sensitive to a wrong focal.
- MapAnything predicts an explicit scale factor but its authors call ScanNet metric scale suboptimal
  ([arXiv 2509.13414](https://arxiv.org/abs/2509.13414)); Pi3X advertises "approximate" scale.
- Phone metadata gives focal length (sanity check for intrinsics), not scale; true metric poses need an ARKit capture app,
  which changes the capture flow. Floor-to-ceiling priors are too scene dependent.

**Plug-in.** Pick ~8 high-confidence keyframes per capture spread over the sweep. Run MoGe-2. For pixels with
`depth_conf` above the median, compute `r = z_metric / z_vggt`, take the per-frame median, then the median over frames
and both captures (the joint pass shares one gauge). Scale all depths, points and translations by `r`. Log the
inter-frame MAD of `r` as scale confidence; if MAD/median > 0.15 fall back to DA3-Metric. Under 2 s, ~50 lines.
Write `units: "m"` and the scale confidence into `changes.json` and the title block.

## 2. Hybrid registration (joint-pass fallback)

**VGGT-CD** (May 2026, training-free, [arXiv 2605.16859](https://arxiv.org/html/2605.16859),
[code](https://github.com/WZ-CS/VGGT-CD)) names the "registration-change paradox" and gives the recipe:

1. one dense VGGT pass per capture;
2. a small joint pass over 2K keyframes from both captures (K≈5–10, FPS-sampled) only to get the inter-capture Sim(3)
   prior; without it ATE degrades to 0.3–3.4 m;
3. Umeyama Sim(3) from each dense pass into the joint frame, on above-median-confidence points;
4. static purification: keep points with nearest-neighbour distance under 3× the median, lock scale and rotation, refine
   translation by centroid offset, accept only if the median residual drops.

Indoor ATE 0.14 m against 0.33 m for VGGT + scale + ICP, in 3–6 s. GS-Pool also found an anchored second capture closer
to deployment. No paper shows a feed-forward model robustly handling a full two-session joint pass with moved objects.

**Plug-in.** Keep the joint pass as the default and run the VGGT-CD path whenever the ICP background residual exceeds the
§3 null, or always: it is two extra 60-frame passes, about 10 s on Modal. If no Sim(3) prior is available, fix scale
first (§1) then **KISS-Matcher** (ICRA 2025, ≥10× faster than TEASER++ pipelines,
[repo](https://github.com/mit-spark/kiss-matcher)) on voxelised background clouds, then the existing Tukey ICP.

**Frames and resolution.** Blur gate by variance of Laplacian relative to neighbouring frames, drop the bottom 20%, then
keep frames inside a 60–80% overlap band (feature-match or flow ratio). The only in-the-wild VGGT-Ω checkpoint is 1B-512
(624×416 balanced); 13.4 GB at 100 frames, 20.8 GB at 200 on an A100, so 120 joint frames are cheap. More frames buy more
than more pixels with this checkpoint.

## 3. Depth-error-aware visibility test

A 13-dataset audit finds feed-forward confidences rank errors well but are overconfident by 2.4× or more, worse at high
confidence, and that scene-level repair fails ([arXiv 2608.29705](https://arxiv.org/abs/2608.29705), Aug 2026). So
`depth_conf` is for gating (drop the bottom 30–50%), never for tolerance.

**Per-scene empirical null (GS-Pool style).** GS-Pool builds the null from primitives assumed unchanged, fits a scaled χ²
and thresholds where about one null object exceeds it; 0.751 mIoU on PASLCD against 0.644 for a fixed threshold
([arXiv 2610.06688](https://arxiv.org/html/2610.06688v1)). In this pipeline: after ICP, take the inlier background
points, project them into the other capture's cameras exactly as the diff does, collect signed residuals
`d_point − d_map`, bin by depth (0.5 m bins), compute MAD per bin, set `tol(z) = 3 · 1.4826 · MAD(z)`. About 40 lines,
negligible compute. Replaces `3 cm + 4%` with a curve measured on this scene.

**Accumulate evidence instead of counting.** Replace (free ≥ 3, same ≤ 25%) with OctoMap-style log-odds per point:
`L += logit(0.7)` for a free vote, `L −= logit(0.6)` for a same vote, clamp to [−2, 3.5], weight each vote by
`min(1, |residual| / tol)` and by the cosine of the grazing angle; decide `L > 1.4` with at least 3 looks. A full sparse
TSDF with ray casting (Fehr et al. 2017; ReFusion [arXiv 1905.02082](https://arxiv.org/pdf/1905.02082)) gives cleaner
"ever free" semantics at the cost of a 2–3 cm voxel ray caster; defer unless the log-odds version proves insufficient.
Pitfall from LiDAR mapping: grazing surfaces oscillate around the threshold, hence the angle weight.

**MVS geometric consistency** (reproject into neighbours, keep a depth pixel only if error < 1 px and relative depth
difference < 1% in ≥ 3 views) prunes edge-flying depth noise before the diff. Run once per capture; it is not a change
test by itself.

## 4. Object-level clustering and footprints

GS-Pool lifts SAM2 masks with a depth-tolerance test and requires ≥ 50% of a primitive's weight inside the mask, merges
tracks at IoU ≥ 0.5 and needs ≥ 2 keyframes; per-object decisions beat per-primitive ones. MV3DIS (CVPR 2026) shows
frame-wise SAM lifting fragments unless masks are matched through a coarse 3D reference
([arXiv 2604.08916](https://arxiv.org/html/2604.08916)); the changed-points-first design here is exactly that reference.
SAM 3 / 3.1 (Nov 2025 / Mar 2026, text, exemplar and point prompts, gated weights) is the best single-image segmenter
([arXiv 2511.16719](https://arxiv.org/html/2511.16719v2)).

**Plug-in.** For each DBSCAN seed blob: pick the 3 cameras with the most free looks in the capture where the object
exists; prompt SAM with a point at the projected centroid plus the projected OBB as a box; lift each mask through that
frame's depth map with the §3 tolerance; keep points in ≥ 2 lifted masks; final blob = (lifted ∩ 2.5-voxel dilation of
changed points) ∪ changed points. About 0.1 s per blob. Fixes both partial clouds and two objects merged in one cluster.

**Footprints.** Fit the floor plane (RANSAC on the lowest 10% of background points), rotate to gravity, run
`cv2.minAreaRect` on the XY projection, height = z range. A tight 2.5D box for the plan; keep the OBB only for output
compatibility. SAM 3D Objects completion works per mask in seconds but hallucinates backs and carries the SAM licence;
deferred.

## 5. Moved-object matching

SceneDiff (Dec 2025): π³ poses + SAM masks + **DINOv3** mask features, greedy one-to-one matching at cosine > 0.7 →
moved, unmatched → added or removed; DINOv3 beat DINOv2 at object level ([arXiv 2512.16908](https://arxiv.org/html/2512.16908v2)).
REMIND uses frozen DINOv3 ViT-S/16 with Hungarian matching for long-term indoor re-ID
([arXiv 2607.09267](https://arxiv.org/html/2607.09267)). DINOv3 correspondence holds to about 120° of rotation.

**Plug-in.** Per blob, from its top-3 views: masked-mean DINOv3 ViT-B/16 patch features plus CLS, L2-normalised,
averaged over views. Cost = 1 − cosine, gated by volume ratio in [0.5, 2] and height ratio; Hungarian; accept at
cosine > 0.7. Verify geometrically: centre both blob clouds, try 8 yaw initialisations (objects rotate about gravity),
point-to-plane ICP, accept if inlier ratio > 0.6 at 2× tol; the ICP transform gives the move's rotation and translation
(report with the 10 cm / 10° tolerance of Objects Can Move, ECCV 2022). Colour histograms become a tie-breaker only.

## 6. Appearance versus geometric change

GS-Diff scores geometric and photometric drift separately; GS-Pool still reports 1.0–1.15% false-alarm pixels on
lighting-only pairs; MV3DCD multiplies a DINOv2 feature difference by an SSIM structure mask and loses least under
lighting change ([arXiv 2412.03911](https://arxiv.org/html/2412.03911v1)). Being geometry-first is already the main
defence. Cheap guards:

- veto a blob if its DINOv3 mask features agree across captures (cosine > 0.8) and its maximum residual is under 2× the
  §3 null: semantically identical and barely displaced, so a depth hallucination from a screen, curtain or shadow;
- thin-on-plane filter: minimum extent < 2·tol and ≥ 80% of points within tol of a background plane → appearance;
- ask the VLM for a change class {object, screen or lighting, textile or soft deformation, shadow} and route non-object
  classes to a separate `appearance` list in `changes.json` instead of dropping them.

## 7. Evaluation protocol

**PASLCD** ([HF dataset](https://huggingface.co/datasets/ChamudithaJay/PASLCD/tree/main)): `PASLCD.zip` 8.9 GB; 10
scenes, 5 indoor; 50–109 reference images; two inference instances per scene (same and changed lighting); 25 masks per
instance, 500 in all; iPhone captures on independent trajectories; COLMAP poses. Metrics: mIoU and F1 on the changed
class at 0.5; an unregistered view scores an empty mask. Leaderboard: GS-Pool 0.751, GS-Diff 0.644, O-SCD 0.552,
MV3DCD 0.478. Define the metric as per-view IoU averaged over GT views and say so (an open SceneDiff issue shows the
ambiguity).

**Steps.** Treat reference and inference frames as the two captures. For each GT view (an inference image whose camera
the pass already gives), project every changed point of the inference capture and every removed point of the reference
with a z-buffer test against that view's depth (±tol), splat 3 px discs, morphologically close, write a binary PNG at GT
resolution, compute IoU and F1. About 150 lines, seconds to run. Object level: 3RScan (1482 scans, per-object
transforms, recall at IoU plus 10 cm / 10° pose tolerance), well over 50 GB. Own captures: turn the recording notes into
{label, type, approximate location}, match blobs by label plus centroid distance ≤ 0.5 m, report precision and recall
per type and mean pose error for moved.

## 8. Labelling robustness

- Three best views, two crops each (tight and 2× context), plus the metric box size in the prompt ("0.42 × 0.31 × 0.18 m,
  0.9 m above the floor"); majority vote on a normalised label, otherwise "unknown". 3–6 Flash-Lite calls per blob.
- Second opinion: SAM 3.1 with the VLM's label as a text prompt on the crop; accept if a mask overlaps the projected box
  at IoU > 0.5, otherwise re-ask with the top-3 alternatives. Grounding DINO 1.6 Pro is API-only; Grounding DINO 1.0 is
  the Apache-licensed fallback.
- Local VLM: Qwen3-VL-8B-Instruct in bf16 needs 16–18 GB and coexists with VGGT-Ω on an 80 GB A100; it also returns
  grounding boxes, so it can be the second opinion too.

## Open uncertainties

VGGT-Ω's scale normalisation and confidence semantics are undocumented and inferred from VGGT; GS-Pool, GS-Diff,
VGGT-CD and the calibration audit are 2026 preprints; MoGe-2 against UniDepthV2 indoors has no independent 2026
comparison; SceneDiff's data release should be checked before planning on it.
