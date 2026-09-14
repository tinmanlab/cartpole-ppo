# What is simulated—and what is not

## Plant, observation and action

The plant is a planar, rigid CartPole on a constrained no-slip wheel drive. Its dynamic state is `[x, v, θ, ω]`. The policy runs at **50 Hz** and each action is integrated through four **200 Hz** semi-implicit plant steps. These are simulation frequencies, not a promise about browser frame rate or hard real-time scheduling.

Default physical settings: translating cart mass 1 kg (including wheel translation), uniform rod mass 0.1 kg, rod half-length 0.5 m, gravity 9.8 m/s². Two wheel/rotor inertias are reflected separately into the translation equation; they are not added a second time as translating wheel mass.

Observation:

```
o = [(goal − measured_x)/2.4,
     measured_v/2.5,
     measured_θ/(π/15),
     measured_ω/2.5,
     goal/2.4]
```

This is fixed scaling, not a hard `[-1,1]` clamp. Measurements can include Gaussian noise. There is no history stack, recurrent memory, explicit motor-state input or privileged Critic input.

The **categorical Actor** samples left/right during training and uses the higher-probability action in deterministic inference. Each action requests a signed **stall-force reference**, ±8 N by default. It is not an arbitrary continuous torque policy and the reference is not the force necessarily delivered to the ground.

## BAM adaptation and wheel coupling

Pinned upstream: Rhoban/BAM commit `e9a619d56da5236206f4de6ceec2c1ee1b497b5c`.

The port reuses the **XL330, MX64 and MX106 M6 parameter files**, the voltage/back-EMF torque equation, and the load-dependent/Stribeck friction budget. Raw JSON bytes and upstream Git blob identities are retained under `vendor/bam/`. A NumPy comparison covers 3,000 scalar cases. This demonstrates equation parity, not full BAM/MuJoCo or hardware equivalence.

```
τ_motor = kt V/R − kt² ω_motor/R
ω_motor = v / (wheel_radius × speed_up_ratio)
reflected_mass = 2 I_wheel/r² + 2 I_rotor/(r × ratio)²
```

The local command adapter converts the force reference into a voltage reference and clamps it to the supply/PWM limit. Supply voltages **5 V for XL330, 12 V for MX64/MX106** are simulator assumptions. They are not the BAM identification-rig voltage or a statement about thermally safe continuous operation. No full firmware position/current loop, communication driver or battery model is included. Identified test-rig offset and delay are not copied into the wheel drive as if they were universal motor constants; separate added transport/response delay is explicit.

The speed-up ratio is **wheel angular speed / servo angular speed**, not a conventional reduction-ratio label. Default ratio is 2. The actual wheel/servo assembly and gearing are not mechanically validated.

ROBOTIS TurtleBot3 URDF supplies the wheel collision/physical definition: radius 0.033 m, width 0.018 m, mass 0.028498940 kg, rolling-axis inertia 2.0712558×10⁻⁵ kg·m². The local visual follows those outer dimensions. Its hub/tread details are illustrative, not the original STL and not manufacturing geometry. See [asset provenance](../assets/NOTICE.md).

## Contact validity, version 2

This release uses the rod's vertical acceleration when evaluating normal contact reaction:

```
N = (mc + mp) g − mp l (θ̈ sinθ + ω² cosθ)
|F_contact| ≤ μ max(0, N)
```

If contact would be lost or the no-slip limit exceeded in any substep, the simulation stops with **model-invalid**. The model does **not** continue with invented tire-slip behavior. The coefficient μ (default 1.2) is an assumed contact bound, not a measured tire property.

The effective external load supplied to BAM friction and the single-track wheel coupling are local reduced-order approximations. They do not resolve individual tire normal loads, load transfer, chassis pitch/yaw, tire compliance, shaft backlash, thermal limits, current protection or structural collisions.

## Reward is a task setting, not an optimizer loss

```
r = 1
    − c_position min((x_next − goal)², 4)
    − c_velocity v_next²
    − c_angle (θ_next/(π/15))²
```

Defaults: `c_position=0.5`, `c_velocity=0.02`, `c_angle=0.05`. The next physical state is unchanged if only these coefficients change; its reward changes. A frozen policy does not adapt to a new cost until learning is resumed or restarted. No energy/jerk cost or discrete failure penalty is included; early termination removes future rewards.

Failures: `|x|>2.4 m`, `|θ|>12°`, or contact/model invalidity. Training and evaluation are capped at 500 control steps = 10 simulated seconds. Time-limit truncation bootstraps the next Critic value; physical termination does not. GAE does not cross either reset boundary. Live uncapped inference removes only the time limit.

## PPO contract

Separate MLPs: Actor `5→16→2` (130 parameters), Critic `5→16→1` (113). Tanh hidden layer; softmax Actor output and linear Critic output. Architecture stays fixed while weights/biases learn.

- 16 environments × 128 control steps = 2,048 experiences/iteration.
- 4 epochs; minibatch 128; 64 separate Actor/Critic Adam updates/iteration.
- γ=0.99; λ=0.95; Actor learning rate 0.0007; Critic 0.002.
- PPO ε=0.2; entropy coefficient 0.005; global gradient-norm cap 0.5 separately per network.
- Adam β₁=0.9, β₂=0.999, ε=10⁻⁸.

Old log probabilities, targets and advantages are fixed data during optimization. The Actor uses normalized GAE advantage; the Critic target uses old value plus **raw** GAE. Critic loss is ½ squared error. There is no value clipping, shared encoder, LR annealing or KL early-stop; approximate KL is diagnostic only. No backpropagation through physics occurs.

A stored lesson contains the **actual final minibatch**, including its pre/post-Adam weights and optimizer moments. One sample's contribution need not agree with the actual probability change after all 128 samples and optimizer history are combined.

## Randomization and curriculum

Per-episode ranges apply only when their factor family is active. At full default mixed intensity: mass ±20%, rod length ±10%, motor-command gain ±15%, extra lag 0–20 ms, delay 0/20 ms, cart viscous friction 0–0.1 N·s/m, constant force bias ±1 N, intermittent pulse amplitude 0–6 N and duration 0.10–0.24 s. The first pulse begins around 1.2–1.8 s, repeats every 2.2 s, and alternates direction. Timing is quantized to control steps.

Noise standard-deviation upper bounds are 0.003 m, 0.02 m/s, 0.001 rad and 0.02 rad/s, multiplied by the configured scale. A standard deviation is not a maximum error. Some inactive factor RNG draws are still consumed for repeatability, but their realized fields are set to nominal.

The ramp uses `min(1, 0.25 + 0.75 × segment_iteration/100)`. Success-gated stages are nominal, pushes, sensors, actuator, model, mixed. Every five iterations, 8 stage probes are run using a fixed seed; two consecutive scores ≥6/8 advance exactly one stage. There is no rollback/demotion, replay rehearsal, formal coverage guarantee or automatic claim promotion. The gate seed and final test seed differ, but repeated gating can still select toward its probe set.

The 1.5× mixed stress preset expands selected randomization amplitudes. It is not “all physically possible OOD.” If a hidden delay or disturbance cannot be inferred from this five-value observation, training cannot magically recover the missing information.

## Interpreting evaluation

A pass requires 500 steps with no physical/validity stop and mean absolute goal error <0.25 m over steps 350–500 inclusive. Automatic progress evaluation is **nominal only**; it is not evidence of 12 N recovery.

The manual suite freezes weights and tests 4 conditions ×12 held-out seeds. It records whether the planned push was reached, how many of its steps were applied, requested/delivered impulse, maximum angle, peak contact ratio, outcome class, and conditional recovery time. Recovery requires a completed pulse followed by 25 consecutive steps with `|x−goal|<0.25 m`, `|v|<0.25 m/s`, `|θ|<3°`, `|ω|<0.4 rad/s`. Null means not established, not zero recovery time.

“Failed before the push” cannot establish rejection of that push. “Model invalid” cannot establish the subsequent real tire behavior. Neither should be combined into an unqualified disturbance-recovery success claim.

## Timing, compatibility and language

Active live time is accumulated in fixed control steps. Pause, frozen samples, stopped failures and hidden tabs are excluded from live RT accounting. Drawing and learning have separate clocks. Performance varies by machine; no hard real-time or physical-hardware claim is made.

Checkpoint v2 includes the physics-version identifier, all optimizer state, per-environment delayed commands and RNG state. Restore is checked for numerical continuation within the same JS runtime. Tiny differences between Node and Chromium math can accumulate during long stochastic training, so identical seeds do not promise cross-runtime bit-identical trained weights.

The current EN/KO entries share physics/PPO/renderer sources. Catalog keys and numeric placeholders are checked at build time. Switching locale never reinitializes a learner or applies a settings draft. The original Korean v1 HTML remains byte-preserved under `archive/ko/` for historical use.
