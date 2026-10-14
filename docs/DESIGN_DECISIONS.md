# Design decisions

Each section: the decision, the alternatives, why, and what it costs.

## 1. One joint reconstruction pass over both captures

**Decision.** Keyframes from the before and after videos go through the model together in one forward pass.
**Alternatives.** Reconstruct each video separately and align with global registration (FPFH + RANSAC, TEASER++,
KISS-Matcher) followed by ICP.
**Why.** VGGT-family models accept an unordered set and place every frame in the first frame's coordinate system,
so a joint pass gives a shared frame and a shared scale for free. The static room is most of the pixels, so the
attention is dominated by geometry the two captures agree on. It is also the cheapest option: one GPU call.
**Cost.** The moved objects are conflicting evidence inside the pass and can smear. Section 2 handles that.
Nobody has published an evaluation of this exact setup, so the first real-video run is the test. If it fails,
`recon.py` can run the two captures separately and `register.py` already contains the refinement loop; only the
coarse global alignment step would need adding.

## 2. Refine on the static background, not the whole cloud

**Decision.** Robust point-to-plane ICP (Tukey kernel) from after to before, three rounds, dropping points with
high residual between rounds.
**Why.** Changed objects are exactly the points that must not drive alignment. Dropping high-residual points after
each round is the simplest way to exclude them without knowing where they are yet.
**Cost.** A few seconds on CPU. Pure rotation or translation symmetry of a room could in theory lock onto a wrong
minimum, but the joint pass starts us close to identity so this is not a practical risk.

## 3. Visibility-aware diff instead of nearest-neighbour diff

**Decision.** Every point is judged by projecting it into the other capture's cameras and comparing its depth
against the reconstructed depth there. Free-space votes mean the ray passed through the point's location. Points
with no votes are unobserved and never reported.
**Alternatives.** Nearest-neighbour distance between clouds (fast, but reports every viewpoint gap as a change).
Voxel occupancy grids with ray casting (equivalent, more memory). 3DGS-based methods (GS-Pool, MV-3DCD: minutes of
per-scene optimisation and COLMAP poses).
**Why.** This is the one requirement the brief stresses and the one a nearest-neighbour diff cannot meet. The
projection test is a few numpy operations per frame and runs on a laptop in seconds.
**Cost.** The depth tolerance is relative to depth (4%) plus 3 cm absolute, hand-set for feed-forward depth error.
Depth-map holes can produce false free-space votes, so a nearest-neighbour guard still vetoes any point that has a
close neighbour in the other cloud. The coverage number reported to the user is the fraction of before points
that received any vote.

## 4. Label only the diff

**Decision.** Blobs are clustered geometrically first, then each blob's best frame is cropped and sent to a VLM
for a name. Moved candidates are confirmed with one two-image call. One final call writes the summary.
**Alternatives.** Full-scene open-vocabulary segmentation (Grounding DINO + SAM + re-ID + multi-pass VLM review),
which is what spatiality_v2 did.
**Why.** Cost. A scene has two to six changes, so this is a handful of Flash-Lite calls, under a cent. It is also
more honest: geometry decides what changed, language only names it.
**Cost.** No labels for stable objects, which the brief does not ask for. A VLM can mislabel a crop; the
`is_object` field lets it veto floor, wall, shadow and reflection blobs, and the pairing call can veto a wrong
moved match.

## 5. Modal for the GPU, laptop for everything else

**Decision.** One Modal function runs the model on an A100-40GB; frames, registration, diff, labelling and the
report run locally. A local script exists for CUDA or Apple MPS but is untested.
**Why.** Only the model needs a GPU, and only for about a minute per scene. Everything else is numpy on a few
hundred thousand points. Keeping the laptop in charge keeps iteration fast and the bill small.

## 6. Outputs are files, the viewer is static

**Decision.** `outputs/<scene>/changes.json` plus PLYs and evidence crops; the Next.js app reads them through one
file route. No orchestrator, no upload flow, no database.
**Why.** The pipeline is offline by nature and the deliverable is a report a robot or a person can read. A
planner consumes the same `changes.json` the viewer renders.

## 7. Scale

**Decision.** Report in model units unless `--scale-m` is given. Pi3X and MapAnything give an approximate metric
scale; VGGT and VGGT-Ω do not.
**Why.** Pretending to know metres when the model does not would be a lie in a robotics context. A later step
can fit scale from a known object or the floor-to-ceiling height.
