# Verification of this public build

Artifact SHA-256 (`index.html`):

`f0365d2549ea27169f94717dab10467560315ace86347e0c0bd5cb999108d021`

These measurements apply to this source/build, not prior Korean versions. They do not imply a hosted deployment or hardware validation.

## What was executed

| Layer | Result | Evidence |
|---|---:|---|
| Public contract / locale / reward / validity | 11 cases passed | [JSON](../evidence/public_contract_tests.json) |
| BAM model tests | 8 cases passed | [JSON](../evidence/bam_tests.json) |
| Recorded lesson / gradient / Adam | 8 cases passed | [JSON](../evidence/lesson_tests.json) |
| Physical/checkpoint/integration contracts | 20 cases passed | [JSON](../evidence/integration_tests.json) |
| Browser workflow regression | 39 cases passed | [JSON](../evidence/browser_tests.json) |
| Bilingual and public-UI contracts | 31 cases passed | [JSON](../evidence/bilingual_tests.json) |
| Independent NumPy BAM equation comparison | 3,000 conditions | [JSON](../evidence/reference_parity.json) |

The six test suites contain **117 passing cases**. The 3,000 equation samples and 243 parameter finite-difference comparisons are additional numerical coverage, not 3,243 separate end-to-end tests.

Both English and Korean use the same engine bytes. Tests preserve weights, both RNG states, selected sample, optimizer iteration, paused physics and unapplied settings across translation. Browser learning while switching language agrees with the independent Node first-update calculation within 1e-12; observed roundoff is ~1e-16. We do not claim bit-identical long training across JS runtimes.

The checkpoint test restores a real training state and reproduces the next rollout and optimizer update within the same runtime. Version-1/mismatched physics checkpoints are rejected rather than silently migrated. Malformed curriculum/provenance/optimizer annotations and prototype keys in imported checkpoints are rejected before restoring state or displaying metadata. This is targeted input hardening, not a general security audit. All 243 Actor/Critic parameter gradients are compared against central finite differences on a fixed sampled loss; all recorded Adam weight updates are reconstructed.

## Fresh browser learning, not the bundled example

Chromium: `144.0.7559.96`. Seed 123, default nominal XL330, 120 PPO iterations, 245,760 collected experiences, 7,680 Adam updates per network.

- Initial random policy: below 30/500 steps in the tested run.
- Final mean nominal survival: **500/500**.
- Balance **and** goal criterion: **12/12**.
- Tail goal error across completed trials: **0.121930 m**.
- Active wall time **28.798800 s**; simulated time **28.800000 s**; measured RT **1.000041668×**.

This is one learning seed on this runtime. “500” means the nominal time cap was reached, not perpetual stability or robust 12 N recovery. Final inference was separately tested beyond 500 steps without automatic reset. Pause/failure holds stop the physics clock rather than reporting fictitious elapsed simulation time.

## Bundled examples and held-out conditions

The nominal and disturbance-trained examples were regenerated with this model for a declared **240-iteration budget** each (491,520 collected experiences). No best-checkpoint selection was performed. Their stored learning trajectories are real. Different training conditions can improve or worsen performance; the disturbance-trained example is not labeled a universal winner.

The following fixed-policy tests are separate from their automatic nominal training scores. Both banks use the same held-out seeds and goals. **Pass includes survival plus the goal condition; model-invalid is reported separately.**

| Bank | Test | Pass | Model-invalid | Pulse reached | Full pulse |
|---|---|---:|---:|---:|---:|
| nominal I.240 | nominal | 12/12 | 0/12 | 0/12 | 0/12 |
| nominal I.240 | mixed | 10/12 | 1/12 | 0/12 | 0/12 |
| nominal I.240 | pulse12 | 1/12 | 7/12 | 12/12 | 5/12 |
| nominal I.240 | ood | 10/12 | 1/12 | 0/12 | 0/12 |
| disturbance-trained I.240 | nominal | 4/12 | 0/12 | 0/12 | 0/12 |
| disturbance-trained I.240 | mixed | 4/12 | 1/12 | 0/12 | 0/12 |
| disturbance-trained I.240 | pulse12 | 3/12 | 7/12 | 12/12 | 5/12 |
| disturbance-trained I.240 | ood | 4/12 | 1/12 | 0/12 | 0/12 |

[All trial data](../evidence/example_trials.json). “Pulse reached” and “full pulse” are 0 for tests with no programmed pulse; that is not a failure to expose them. The programmed push is +12 N at t=3 s for 0.20 s; requested impulse is 2.4 N·s. A stopped trial may receive less. Model-invalid cases stop at the no-slip/contact boundary and do not predict subsequent real slipping/flight.

Recovery time is conditional on a completed pulse plus a 0.5 s dwell inside position/velocity/angle/angular-speed thresholds; null means not established. It is not a stability certificate. Automatic progress-chart evaluation remains nominal only.

## Actual usage video

[Walkthrough MP4](media/walkthrough.mp4): **73.52 seconds**, H.264/yuv420p, 1600×1000, 4.71 MiB. [README GIF](media/demo.gif): a 14-second crop of the real simulation card at 10 fps, not a generated animation.

[Capture script](../tools/record_demo.py) · [Recording provenance](../evidence/media_recording.json).

The video shows the bundled nominal example, real target changes and a 4 N push, EN/KO switching, the same recorded sample's network/GAE/Adam calculations, an unapplied reward-cost draft, a separate new 20-iteration learner, and held-out tests of the explicitly reselected bundled policy. Captions are editorial overlays; physics, time, model outputs and learning curves are not mocked or sped up. It is a selected feature demonstration, not a random evaluation sample. No narration/music is included; the explanatory captions are embedded in the recording.

The GitHub README embeds a GIF linked to the MP4. The local HTML video player provides controls. We do not rely on unsupported raw `<video>` markup in GitHub Markdown and do not claim a user-attachment video was uploaded.

## Loading and visual review

Browser tests and recording loaded the **exact distributed HTML bytes** with `page.set_content`. The actual Blob Web Workers and Canvas/SVG views ran without external runtime requests or uncaught page exceptions. English desktop layouts were checked at 1280, 1440 and 1920 pixels wide. The original Korean viewer's SHA-256 is preserved in its [archive manifest](../archive/ko/manifest.json).

A direct `file://` navigation was attempted again and was blocked by this managed Chromium's administrator policy: `ERR_BLOCKED_BY_ADMINISTRATOR`. [Recorded result](../evidence/native_navigation.json). That is a navigation-policy limitation; it is not evidence of a successful Windows double-click end-to-end test. Normal local use is the intended path; where file navigation is restricted, serve the repo on localhost under your allowed browser policy.

Representative encoded-video frames and the chapter/network/Adam/evaluation screenshots were inspected. The preview and video contain the actual viewer, not the earlier concept art. No mobile work is included.

## Remaining boundaries

The source model remains a planar no-slip surrogate, with categorical left/right force references and no observation history. Original wheel STL, complete BAM firmware, tire slip, chassis dynamics, battery/thermal/current safety and hardware validation are **not completed**. Independent equation matching does not validate the wheel coupling. Details and assumptions belong to [MODEL.md](MODEL.md), not to a blanket “realistic robot” or “all disturbances solved” claim.
