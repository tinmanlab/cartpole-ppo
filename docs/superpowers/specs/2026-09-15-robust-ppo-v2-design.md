# Robust PPO v2 — Design Specification

## Goal

Build an optional robust-control training path that expands the recoverable disturbance envelope without relabelling physically unrecoverable or model-invalid cases as policy failures. The method must remain educational: every robustness mechanism has to be inspectable and must preserve the existing legacy PPO path and historical examples.

## Why the current robust path is insufficient

The current disturbance-trained example randomizes cart-body pushes, model parameters, sensor noise and actuator response. Manual pole-tip force is test-only. Therefore pole-tip recovery is out-of-distribution. The current policy is also limited by a discrete ±force action, memoryless observations and a symmetric critic that receives the same partial observation as the actor. The existing ramp curriculum is iteration-driven rather than success-gated, and its automatic score is nominal-only.

The design therefore changes four things together: action representation, observability, disturbance distribution/curriculum, and evaluation.

## Non-goals

- Do not claim recovery from every disturbance.
- Do not make 12 N pole-tip force a success target. It remains an extreme stress test unless actuator authority changes enough to make it feasible.
- Do not silently change legacy `Trainer`, `planar-bam/2`, v2 checkpoints, built-in examples or their body-pulse semantics.
- Do not add RARL/adversarial training in this version.
- Do not add a backend, database or new runtime dependency.
- Do not simulate tire slip, flight, thermal protection or hardware safety beyond the current explicit model-validity stop.

## Architecture

Robust PPO v2 is a separate training engine layered on the same `CartPole`/BAM plant. The legacy discrete PPO remains intact.

New modules:

- `src/robust_v2.js`: continuous Gaussian policy, history encoder, privileged critic input, authority-normalized disturbance sampler, adaptive curriculum, robust trainer and robustness-envelope evaluation.
- `src/robust_worker.js`: Web Worker protocol for Robust PPO v2 training/evaluation/checkpoints.
- `src/robust_ui.js`: one collapsible experiment card in Chapter 5. It shows method state, curriculum boundary and robustness envelope without duplicating the main CartPole simulation.

Small extensions to existing modules:

- `CartPole.stepContinuous(action, cartForce=0, tipForce=0)` accepts normalized continuous action `u∈[-1,1]`, maps it to `u * spec.force`, and uses the same actuator/delay/friction/plant path as the discrete step.
- `src/build.py` includes the robust engine/worker/UI in the standalone artifact.

## Continuous policy

### Actor

- Actor input: 5-step history.
- Per history item: 5 scaled observations + previous normalized action = 6 values.
- Actor input dimension: `5 × 6 = 30`.
- Network: `30 → 32 → 2`.
- Output 0: Gaussian mean `μ` in pre-tanh action space.
- Output 1: state-dependent `log σ`, clamped to `[-3.0, 0.5]`.
- Stochastic training action: `z = μ + σ ε`, `ε~N(0,1)`, `u=tanh(z)`.
- Deterministic inference action: `u=tanh(μ)`.
- Environment command: `F_ref = u * spec.force`.

PPO log probability uses the tanh-transformed Gaussian density. For a stored action, `z=atanh(u)` is fixed when evaluating the new policy, so the tanh Jacobian term is included in log probability but has zero parameter derivative for the PPO gradient.

### Critic

The critic is asymmetric during training.

- Actor history: 30 values.
- Privileged current state and dynamics: 14 values.
- Critic input dimension: 44.
- Network: `44 → 64 → 1`.

Privileged values are:

1. true `x`
2. true `x_dot`
3. true `theta`
4. true `theta_dot`
5. goal
6. `mc / nominal_mc`
7. `mp / nominal_mp`
8. `l / nominal_l`
9. actuator gain
10. actuator lag normalized by configured maximum
11. command delay normalized by configured maximum
12. body friction normalized by configured maximum
13. current cart-body external force normalized by available drive
14. current pole-tip force normalized by current recoverable tip-force authority

The actor never receives privileged parameters or the true disturbance force.

## History semantics

Each environment owns a five-element history deque. At reset, fill it with five copies of `[obs0..obs4, 0]`. At each control step:

1. build actor input from the current deque;
2. sample action;
3. step physics;
4. append `[current_observation0..4, action]` for use on the next decision.

History state must be checkpointed.

## Reward

Robust v2 retains the current task reward and adds control regularization:

`r = r_legacy - 0.002*u^2 - 0.01*(u-u_prev)^2`

On physical termination, add `-5.0`. Time-limit truncation does not receive the termination penalty.

The disturbance itself is not penalized. The policy is rewarded for survival, goal tracking, limited speed/tilt and smooth economical control.

## Disturbance authority

Do not specify pole-tip curriculum primarily in Newtons. Define an actuator-relative authority ratio.

At upright equilibrium, compute the wheel force approximately required to hold zero pole angular acceleration against a horizontal pole-tip load:

`F_required = (2*(mc + mp + J_reflected)/mp - 1) * F_tip`

Estimate available low-speed wheel force from the selected BAM/ideal actuator under the current gear ratio and command limit. Define:

`authority_ratio = abs(F_required) / max_available_wheel_force`

This ratio is the curriculum coordinate for pole-tip loads. Values near 1 are near the modeled recovery authority; values above 1 are stress/OOD rather than training targets.

The implementation must expose both the requested Newton value and the authority ratio.

## Training distribution

Every episode first decides whether it is nominal or disturbed.

- 30% nominal: no exogenous body/tip force and nominal physical parameters.
- 25% tip impulse: one randomized pole-tip pulse.
- 10% tip hold: one lower-amplitude sustained pole-tip load.
- 15% cart-body impulse: one randomized body pulse.
- 20% mixed: parameter/noise/actuator randomization plus one randomized body or tip event.

Physical parameters are sampled once per episode. Sensor noise remains per observation. Exogenous force event timing is randomized per episode.

First event start time is uniformly sampled in `[0.30, 0.90] s`, so weak early policies actually experience disturbances. Later events may be sampled every `[1.5, 3.0] s` if the episode survives.

### Tip impulse

- sign: random
- duration: `[0.05, 0.20] s`
- authority ratio: uniformly `[0.35*boundary, boundary]`

### Tip hold

- sign: random
- duration: `[0.30, 0.80] s`
- authority ratio: uniformly `[0.15*boundary, 0.40*boundary]`

### Body impulse

Scale body force against modeled available wheel force rather than reuse the tip ratio directly.

- sign: random
- duration: `[0.05, 0.25] s`
- body force magnitude: `[0.20, 0.70] * boundary * available_wheel_force`

### Mixed episode parameter ranges at boundary=1

Reuse the existing maximum educational ranges:

- cart/pole mass and length: current `modelSpread`
- actuator gain: current `gainSpread`
- command delay: current configured maximum
- actuator lag: current configured maximum
- body friction: current configured maximum
- sensor noise: current configured maximum
- background cart-body bias/wind: current configured maximum

At boundary `<1`, multiply each deviation from nominal by boundary.

## Adaptive disturbance curriculum

Replace the robust-v2 iteration ramp with performance-gated expansion/contraction. Legacy curriculum remains unchanged.

Boundary levels:

`[0.10, 0.20, 0.35, 0.50, 0.65, 0.80]`

Start at `0.10`.

Every five PPO iterations run independent gate seeds, separate from rollout RNG, on:

- nominal: 8 trials
- tip impulse at current boundary: 8 trials
- mixed disturbance at current boundary: 8 trials

Promotion requires, for two consecutive gates:

- nominal success ≥ 7/8
- tip success ≥ 6/8
- mixed success ≥ 6/8

If tip or mixed success falls below 4/8 at a nonzero higher boundary, contract one level and clear the promotion streak. Otherwise hold the current level.

Success means:

- no physical/model-invalid termination;
- 500 control steps reached;
- tail goal error `<0.25 m`.

Gate seeds must not overlap training or final-test seeds.

## PPO update

Keep the existing browser-friendly rollout budget:

- 16 environments
- 128 steps/environment = 2,048 transitions/iteration
- 4 epochs
- minibatch 128
- 64 minibatch updates/iteration
- `gamma=0.99`
- `lambda=0.95`
- PPO clip `0.2`
- actor learning rate `3e-4`
- critic learning rate `1e-3`
- entropy coefficient `0.002`
- global gradient norm limit `0.5`

Advantage normalization remains per rollout. Termination bootstraps to zero; time-limit truncation may bootstrap from the critic.

## Robustness envelope

The robust policy is not accepted from nominal score alone.

Explicit evaluation generates a pole-tip force × duration envelope using independent final-test seeds:

Authority ratios:

`[0.00, 0.10, 0.20, 0.35, 0.50, 0.65, 0.80, 1.00, 1.25]`

Durations:

`[0.05, 0.10, 0.20, 0.40] s`

For every cell record:

- success count / trials
- model-invalid count
- max absolute pole angle
- max absolute position error
- recovery time where established
- actuator saturation fraction

Ratios `>1.0` are labelled stress/OOD and never used for curriculum promotion.

Also retain separate nominal, body-pulse and mixed suites so improvement in one family cannot hide regression in another.

## UI

Chapter 5 gains one collapsed `Robust PPO v2` section rather than another simulator.

When opened it shows:

1. method summary: continuous action, 5-step history, asymmetric critic;
2. current boundary as both authority ratio and approximate tip-force Newton range;
3. curriculum gate results;
4. training progress;
5. robustness envelope heatmap/table;
6. explicit `stress/OOD` label for authority ratios above 1.

The main CartPole remains the only animated simulation. A completed robust-v2 evaluation may replay one recorded robust rollout in the existing replay surface.

## Checkpoints

Use a new schema: `cartpole-robust-v2-checkpoint/v1`.

Checkpoint includes:

- actor/critic parameters and Adam state;
- trainer RNG;
- each environment RNG and physical state;
- five-step observation/action histories;
- disturbance schedules and active event state;
- curriculum boundary index/streak/history;
- training counters and hyperparameters.

Legacy v2 checkpoints are not migrated into robust v2.

## Verification

Required numerical/unit tests:

- continuous zero/±1 actions map to 0/±`spec.force` through the same actuator path;
- discrete legacy `step()` remains numerically unchanged;
- Gaussian log probability and analytic gradients match finite differences;
- tanh action stays strictly inside `[-1,1]`;
- history reset/shift semantics are exact;
- actor input never contains privileged variables;
- privileged critic vector values/normalization are deterministic;
- authority ratio is monotonic in tip force and responds to actuator/gearing changes;
- nominal episode fraction and disturbance family sampling are within deterministic seeded expectations;
- curriculum promotes, holds and contracts at exact thresholds;
- robust checkpoint round-trip reproduces the next rollout/update within one runtime;
- envelope labels authority `>1` as stress/OOD;
- legacy test suites still pass.

Required browser tests:

- robust trainer starts independently from legacy learner;
- one robust iteration collects 2,048 transitions and 64 updates;
- curriculum boundary is visible and changes only after gate criteria;
- envelope evaluation produces all cells and distinguishes model-invalid outcomes;
- language switching preserves robust trainer/view state;
- no second animated CartPole is introduced;
- hosted Pages remains functional after merge.

## Acceptance criteria

The feature is acceptable when:

1. legacy nominal behavior and v2 checkpoint tests remain green;
2. robust-v2 training is real and independently reproducible within a runtime;
3. a fixed-budget multi-seed experiment shows no material nominal collapse and improves success at one or more in-range tip/mixed envelope cells versus the nominal legacy policy;
4. no claim is made for cells above actuator authority or model-validity limits;
5. UI makes `training distribution`, `current boundary`, `final-test envelope`, and `stress/OOD` visibly distinct.
