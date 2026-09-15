# Work on one engine, not two language forks

## Entry points

`index.html` and `viewer.ko.html` are **generated build outputs, not tracked sources**, from the same `src/` and `locales/`. The sole entry difference is the initial language. Edit the sources, then run `python src/build.py`. CI does the same before staging Pages; the published HTML remains fully standalone. Do not hand-edit generated files or overwrite the byte-preserved archive.

`src/plant.js` owns actuator/wheel coupling and physical ranges. `src/core.js` owns dynamics state, PPO and checkpoints. `src/lesson.js` explains stored computations without changing them. `src/app.js` owns the viewer; `src/extension.js` owns condition transactions. Locale changes must not mutate any of those numerical states.

The message catalogs require identical keys and positional placeholders. `src/i18n.js` formats text only; it never decides model behavior. Static controls are bound with `data-i18n`; dynamic UI calls `tr`. Raw physics/checkpoint error codes may remain English so they are stable for diagnostics.

## Quick checks

```bash
node tools/test.js
python src/build.py
python src/build.py --check
```

Additional development dependencies:

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium ffmpeg
python tests/reference_parity.py
python tests/test_bilingual.py
python tests/test_browser_bam.py
```

System Chromium is used automatically at `/usr/bin/chromium`, or set `CHROMIUM_PATH`; otherwise tests use Playwright's browser. Browser tests load the exact standalone bytes with `set_content` so they also work in constrained runtimes. Verify `file://` opening separately where permitted. Current evidence must identify the load method rather than claiming an untested double-click path.

## Regenerate the built-in experiments

```bash
node tools/generate_examples.js nominal
node tools/generate_examples.js robust
python src/build.py
```

Each command trains from seed 123 for a **declared 240-iteration budget**; the final budget checkpoint is included, not the best OOD checkpoint. Recorded iterations are 0, 1, 10, 30, 60, 120, 240. The `robust` filename means *disturbance-trained*, not a robustness guarantee. Wall-time fields differ between runs. Cross-runtime floating-point differences may change later stochastic training; do not assert bit-identical Node/Chromium weights from seed alone.

Do not overwrite evidence with a marketing-friendly subset. Keep nominal and held-out conditions, pulse exposure and model-invalid outcomes separate. A demonstration video is not an evaluation sample.

## Reproduce the historical walkthrough

```bash
python tools/record_demo.py
```

Requires ffmpeg/ffprobe on PATH and Playwright's video recorder dependency. The script intentionally opens `archive/en/body-pulse.v2.html`, not the current held-tip viewer. It operates that real historical viewer, overlays short editorial captions, and saves MP4/GIF/screenshots and `evidence/media_recording.json`. No fake charts, hidden PID or physics-speed changes. It is a scripted UI tour, not an exhaustive benchmark. Review the encoded video and representative frames after recording.

## Review gates

Check that a condition draft does not apply itself; test-only does not retrain; continuation retains optimizer state; a new learner starts random; locale switches preserve selections and numerics; stopped physics does not keep counting time; stage gates cannot silently promote failed results; historical samples and current inference are not mixed.

Physical changes require a model/checkpoint version decision and fresh examples/evidence. Do not reinterpret old checkpoints as the same experiment. Importing real CAD does not by itself identify friction, inertia, contact behavior or safe operating limits.

Keep runtime dependencies at zero unless a demonstrated gap justifies a change. Avoid new orchestration, backend databases, decorative effects or multiple competing rendering/translation frameworks.

The held tip wrench is an optional external input (`cart+tip/v1`). The default zero-tip branch is numerically identical to the pinned planar-bam/2 plant. Historical checkpoints, curricula and body-pulse evaluations are not relabelled as tip-force training. `tests/test_tip.js` verifies the coupled equations and legacy no-tip parity. `tests/test_tip_browser.py` verifies held input on local or hosted HTML.
