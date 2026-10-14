# Research notes: reconstruction models and 3D change detection (as of 2026-10-14)

Compiled from a literature and repository survey on 2026-10-14. Links were checked on that date; verify
licences before any commercial use. The pipeline decisions this led to are in `DESIGN_DECISIONS.md`.

## Executive summary

1. **Primary model: VGGT-Ω (VGGT-Omega) 1B-512**, Meta/Oxford, [arXiv 2605.15195](https://arxiv.org/abs/2605.15195)
   (May 2026, CVPR 2026 oral). About 30% of VGGT's memory, 500 frames in 43 GB on one A100, and the only
   feed-forward model that stayed coherent under wide viewpoint spans in an independent stress test.
   Caveats: gated weights under a non-commercial research licence, non-metric scale, first-frame gauge.
2. **Fallback: Pi3X** (ICLR 2026, Dec 2025 release). Permutation-equivariant, so there is no reference frame
   and two captures can be concatenated in any order; approximately metric; CC BY-NC weights.
   If a commercial licence matters: **MapAnything-apache** (Apache 2.0, metric).
3. **Registration:** one joint forward pass over subsampled frames of both videos is a legitimate way to get a
   shared frame (VGGT-family models accept arbitrary order; the first frame fixes the gauge), but moved objects
   are conflicting evidence inside the pass. Refine on the static background with robust ICP, dropping
   high-residual clusters between rounds.
4. **Change detection:** no off-the-shelf 2026 method does this from feed-forward input. The sound and cheap
   approach is visibility-aware ray-cast occupancy comparison: occupied in A and observed free in B means
   removed, the reverse means added, unobserved in either stays unknown. GS-Pool's rule of deciding only on
   primitives inside at least two camera frusta of the other visit is the visibility gating to copy.
5. **Labelling:** SAM 3 / 3.1 for masks if needed; Gemini Flash or Qwen3-VL on crops for names.
6. **Evaluation:** PASLCD (5 indoor iPhone scenes), 3DGS-CD dataset, 3RScan.

## 1. Feed-forward multi-view reconstruction

| Model | Date | Outputs | Metric | Unordered input | Licence | Notes |
|---|---|---|---|---|---|---|
| [VGGT-Ω](https://github.com/facebookresearch/vggt-omega) | May 2026 | cameras, depth + conf, points | no | yes, first frame = gauge | FAIR non-commercial, gated | 100 fr 13 GB, 200 fr 21 GB, 500 fr 43 GB on A100 at 624x416 |
| [Pi3 / Pi3X](https://github.com/yyfz/Pi3) | Jul / Dec 2025 | world + local points, conf, cam2world | approx. | yes, no reference frame | BSD code, CC BY-NC weights | ~24 GB for 100 views; a 32-bit index error near 200 frames reported |
| [MapAnything](https://github.com/facebookresearch/map-anything) | Sep 2025 | points, depth, rays, K, poses, conf, masks | yes | yes | Apache 2.0 variant | up to 2000 views in memory-efficient mode; ghosts on moving objects |
| [Depth Anything 3](https://github.com/ByteDance-Seed/Depth-Anything-3) | Nov 2025 | depth, conf, cameras, 3DGS | some variants | yes | Apache for Base/Small | VGGT-Ω reports beating it |
| [VGGT](https://github.com/facebookresearch/vggt) | Mar 2025 | cameras, depth + conf, points, tracks | no | yes | VGGT-1B-Commercial exists | May 2026 memory fix |
| FlashVGGT, VGG-T³, VGGT-Long | Dec 2025 to 2026 | same as VGGT | no | yes | various | long-sequence variants; not needed for one room |
| DUSt3R / MASt3R / MUSt3R / CUT3R / Fast3R | 2024 to 2025 | pairwise or streaming | no | partial | non-commercial | superseded; MASt3R still useful as a matcher |

VGGT-Ω specifics: single dense head with multi-task supervision, register attention for inter-frame exchange,
20x supervised and 100x unsupervised data, dynamic-scene annotation. The authors disclosed possible benchmark
contamination in an ancestor of the original 1B checkpoint; a retrained 1B-416-Reproduction (Sep 2026) is the
benchmarking reference, while 1B-512 is still recommended for in-the-wild use. Independent test
([When Wider Views Fail](https://arxiv.org/abs/2609.24839), Sep 2026): VGGT and Pi3X collapse as angular span
widens, VGGT-Ω stays coherent, on two outdoor scenes only.

Ranking for this task: VGGT-Ω 1B-512, then Pi3X, then MapAnything (metric and Apache if licensing matters), then
VGGT-1B-Commercial. Subsample each video to 40 to 100 frames so both fit in one pass.

## 2. Registering two reconstructions when objects moved

- VGGT: image order is arbitrary; the first image is the reference. S-VGGT shows that independently processed
  subsets land in different frames and fixes it by prepending a shared anchor frame. The same trick works for two
  captures. Independent chunks differ in frame and scale, so separate passes need a Sim(3) alignment.
- The change-detection literature overwhelmingly reconstructs separately and registers on the static scene
  (GS-Pool, MV-3DCD, CL-Splats, OASIS-Map). No paper evaluates a single feed-forward pass over two sessions with
  rearranged objects; the risk is that global attention fuses the two states. VGGT-Ω was trained with dynamic
  data and may degrade more gracefully; unverified.
- Tools for the refinement step: [TEASER++](https://github.com/MIT-SPARK/TEASER-plusplus),
  [KISS-Matcher](https://github.com/mit-spark/kiss-matcher), Open3D RANSAC-FPFH + ICP,
  [MASt3R](https://github.com/naver/mast3r) matches, VGGT's track head + Kabsch,
  [PointVGGT](https://arxiv.org/html/2610.11612) (Oct 2026, unverified).

## 3. 3D scene change detection (2022 to 2026)

Visibility and free-space aware, which is the key requirement:

- Ray-cast occupancy differencing: cast rays from each camera through depth to mark free space in an
  OctoMap/TSDF; changed = occupied in one and free in the other; unobserved stays unknown.
  [Stereo V-SLAM change detection, 2022](https://arxiv.org/pdf/2207.00246),
  CSIRO [raycloudtools](https://github.com/csiro-robotics/raycloudtools) `raytransients`.
- [GS-Pool](https://arxiv.org/html/2610.06688v1) (Oct 2026, [repo](https://github.com/BoazKG93/gs-pool)): two
  independent 3DGS, SAM2 masks lifted to Gaussians, four per-primitive scores, per-scene null threshold from
  unchanged objects. Scores only primitives inside at least two camera frusta of the other visit; alpha
  compositing discounts occluded pixels. State of the art on PASLCD (0.751 mIoU), 2 to 6 min per scene on a 4090.
- [GS-Diff](https://arxiv.org/pdf/2605.07203) (May 2026): primitive-space comparison, separates geometric from
  appearance change.
- [MV-3DCD](https://github.com/Chumsy0725/MV3DCD) (CVPR 2025): pre-change 3DGS rendered at post-change poses,
  DINOv2 feature difference; introduces PASLCD. No explicit free-space reasoning.
- [CL-Splats](https://github.com/jan-ackermann/cl-splats) (ICCV 2025), [3DGS-CD](https://github.com/520xyxyzq/3DGS-CD)
  (RAL 2025), [SCaR-3D](https://arxiv.org/html/2512.22830) (3DV 2025).
- [OASIS-Map](https://arxiv.org/abs/2607.14899) (Jul 2026, Oxford): object-level multi-session mapping via dense
  semantic correspondence, 0.667 F1 moved-object association on 3RScan; code not found.
- [Living Scenes](https://github.com/GradientSpaces/LivingScenes) (CVPR 2024),
  [Objects Can Move](https://github.com/katadam/objectscanmove) (ECCV 2022),
  [Has Anything Changed?](https://arxiv.org/abs/2312.01148) (notes rescans are partial so occluded parts get no decision).
- Curated list: [Awesome-Scene-Change-Detection](https://github.com/DoongLi/Awesome-Scene-Change-Detection).

Practical takeaway: the 3DGS methods need per-scene optimisation and COLMAP-quality poses. With feed-forward
output, ray-cast occupancy plus object clustering plus frustum gating is the fastest sound pipeline.

## 4. Labelling change regions

1. [SAM 3 / 3.1](https://github.com/facebookresearch/sam3) (Nov 2025 / Mar 2026): concept prompts, custom licence.
2. [Qwen3-VL](https://arxiv.org/pdf/2511.21631) (Dec 2025): open weights, open-vocab grounding, runs locally.
3. Gemini Flash / Pro (API): strongest zero-shot crop labelling; Flash-Lite is the cheapest adequate option.

## 5. Evaluation datasets

- [PASLCD](https://chumsy0725.github.io/MV-3DCD/) (CVPR 2025): 10 real scenes, 5 indoor, iPhone captures with
  independent trajectories, 50 change masks per scene. Closest match to the challenge.
- [3DGS-CD dataset](https://github.com/520xyxyzq/3DGS-CD): object move/swap/insert in cluttered real scenes.
- [3RScan](https://arxiv.org/pdf/1908.06109): 1482 RGB-D rescans with 6-DoF object ground truth.
- [ChangeSim](https://arxiv.org/abs/2103.05368): synthetic warehouse; less suited to room-scale rearrangement.
