# CartPole PPO Studio

**Watch a policy balance a pole. Follow one real decision all the way to a weight update.**

A local, bilingual reinforcement-learning lab: real CartPole physics, real PPO learning in a Web Worker, and inspectable Actor/Critic arithmetic. No server, GPU, account, or runtime download.

[![Watch the actual browser walkthrough](docs/media/demo.gif)](docs/media/walkthrough.mp4)

**[Watch the walkthrough](docs/demo.html)** · **[English viewer](index.html)** · **[한국어](README.ko.md)** · [Model & limits](docs/MODEL.md)

> Download this repository and open **`index.html`** in a desktop browser. GitHub's source-file page is not the running app. The viewer starts in English; change **Language** without restarting the simulation or learner. `viewer.ko.html` starts in Korean.

## Three ways to use it

| Your question | Where to go |
|---|---|
| **What does the network actually compute?** | Chapters 1–4: one observation → both networks → reward/GAE → the actual minibatch and Adam update. Click a neuron; inspect its arithmetic directly below. |
| **Can it learn here, rather than replay an animation?** | Chapter 5 → **Start training**. Your learner starts at random I.0, separately from the pretrained example. Finished iterations update the displayed policy. |
| **What happens with a different motor, cost or disturbance?** | **Model · conditions**. Choose **Apply to test only**, **Keep weights · configure continuation**, or **Create new learner**—then explicitly start training. |

The opening cart uses a **bundled, genuinely trained example**. It does not imply that your own learner has already trained. Recorded calculation playback never changes weights. Testing a frozen policy never trains it.

## What makes the lab useful

- **Five connected lessons, one simulation.** Actor `5→16→2`; Critic `5→16→1`. Activation values and signed weights are distinct from recorded update deltas. A selected sample stays selected across chapters.
- **Actual PPO.** Rollouts, termination-aware GAE, clipped surrogate, entropy bonus, analytic backpropagation, minibatch means, gradient clipping and Adam. Inspect the numbers that were actually used—not staged “learning” effects.
- **Actuator-aware physics.** Select XL330, MX64, MX106, or an ideal-force comparison. The JavaScript port uses pinned [Rhoban/BAM](https://github.com/Rhoban/bam) M6 parameters and torque/friction equations, with an explicitly separate wheel-drive adapter.
- **Deliberate experiments.** Change position, velocity and angle costs; inspect mass, gearing, voltage saturation and contact limits; introduce pushes, wind, sensor noise, delays and parameter variation. Fixed, ramped and success-gated curricula are separate choices.
- **Repeatable inspection.** Slow/stepwise replay, frozen uncapped inference, optional auto-reset, held-out tests with exposure/failure diagnostics, and versioned optimizer checkpoints. EN/KO share one engine and one source of messages.

## Try this first

Open **Actor · Critic**, select a neuron, then step through **Multiply + sum → tanh → Outputs**. Go to **Learning signal**, then **PPO update** without changing the sample. You can now distinguish “the input changed” from “the weights changed.”

For your first experiment, keep the default XL330 and nominal conditions. Train in chapter 5, then **Finish · freeze**. Try a small 4 N push and inspect the force trace. A manual push is a test input—not training data. A larger push may cross this model's contact limit; it is not automatically a policy failure or a meaningful hardware test.

[Full hands-on tutorial](docs/TUTORIAL.md) · [Experiment/model contract](docs/MODEL.md) · [Verification](docs/VERIFICATION.md)

## Evidence, not a robustness claim

Tests cover all **243 neural parameters** against finite differences, recorded Adam reconstruction, checkpoint continuation, three-motor BAM equation parity, real browser training, and EN/KO state preservation. The walkthrough is a recording of the distributed HTML. [Capture and verification provenance](docs/VERIFICATION.md) explains the conditions and what was not tested.

This is a **goal-conditioned educational CartPole**, not the unchanged Gymnasium benchmark and not a deployable robot controller. BAM is an equation port, not the Python/MuJoCo runtime or complete motor firmware. The wheel's dimensions/inertia are sourced; its appearance is a local reconstruction, **not the original STL**. Tire slip, full chassis dynamics, thermal protection and real hardware validation remain out of scope. No success on all OOD disturbances is promised.

## Develop and reproduce

Runtime: a desktop browser only. Build: Python 3 standard library. Engine tests: Node.js 22.

```bash
python src/build.py            # index.html + viewer.ko.html, from the same sources
node tools/test.js             # numerical, physics, checkpoint and locale tests
python src/build.py --check    # committed HTML matches the sources
```

Browser/independent equation tests and the actual-video capture:

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python tests/test_bilingual.py
python tests/test_browser_bam.py
python tests/reference_parity.py
python tools/record_demo.py
```

Set `CHROMIUM_PATH` when using an existing Chromium executable. Recording additionally requires **ffmpeg** and **ffprobe**. See [CONTRIBUTING.md](CONTRIBUTING.md) for data regeneration and review checks.

## Source map and attribution

`src/` owns physics, PPO, lessons and rendering. `locales/` owns EN/KO wording. `examples/` contains version-2 trained checkpoints. `docs/` contains the walkthrough and experiment boundaries. `archive/ko/` preserves the original Korean viewer without changing its bytes; it is a historical version, not a second active implementation.

The repository's original [MIT license](LICENSE) is retained. **BAM-derived code and imported model data retain Apache-2.0 notices**; see [THIRD_PARTY.md](THIRD_PARTY.md), [BAM provenance](vendor/bam/NOTICE.md), and [wheel provenance](assets/NOTICE.md).
