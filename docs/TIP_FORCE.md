# Held pole-tip force and a readable control loop

## What changed

The previous Live buttons used a `click` event: on release, they scheduled a
short horizontal **cart-body** pulse. Holding the button itself did nothing.
They now apply a horizontal **pole-tip** force from pointer/key down until
release. This is a changed input contract, not improved learned robustness.

The policy is evaluated before every 20 ms environment step, even during a hold.
Its command still goes through the selected BAM actuator and wheel model.
`policyCalls` counts those actual control evaluations, not UI redraws. It is not
an optimizer-update count. The environment integrates four 5 ms substeps per
control step. There is no hidden hand-coded balancing controller.

A strong force can cause failure or violate the no-slip/contact model. Such a
trial stops and explicitly reports the cause; it does not continue a physically
unsupported animation. Releasing, pointer cancellation/lost capture, keyup,
window blur, tab visibility change, Escape, pause, reset, a modal, or entry into
recorded calculations clears held input. Auto-reset never carries a held force
into a fresh episode: press again to apply it there.

## Two different application points

`CartPole.step(action, cartForce=0, tipForce=0)` preserves the prior meaning of its
second argument. For rod half-length l and angle theta from upright, a horizontal
force at the tip contributes generalized forces Qx=Ftip and
Qtheta=2*l*cos(theta)*Ftip. It must not be passed to the cart-force argument.
With rod mass m, cart mass M and reflected wheel/rotor mass J:

```
(M+m+J) a + m*l*cos(theta) alpha = Fdrive + Fcart + Ftip
                                  - b*v + m*l*omega^2*sin(theta)
(4/3)*m*l^2 alpha + m*l*cos(theta) a = m*g*l*sin(theta)
                                      + 2*l*cos(theta)*Ftip
```

Here Fdrive excludes wheel/rotor inertia but includes mapped motor and friction
forces. Equivalently, use M+m on the left and the ground contact force on the
right. These conventions must not be mixed (that would double-count inertia).
The elimination adds `Ftip*(1-1.5*cos(theta)^2)` to the cart RHS and
`2*Ftip*cos(theta)/m` to the rod acceleration numerator. Normal force uses the
resulting angular acceleration. Horizontal input adds no direct vertical load.

A 12 N tip force and a 12 N cart force are **not equivalent tests**. Tip force
has a lever arm. 0.1 N is the initial exploratory setting, not a safety rating.

## Scope / compatibility

The manual tip input is **test-only**, not training data. Existing curricula,
checkpoints, saved examples and independent scripted pulse evaluations still
use cart-body disturbances. The UI labels this separation rather than quietly
changing an existing experiment. No new tip-force policy has been trained.

The optional wrench is tagged `cart+tip/v1`. The zero-tip numerical branch stays
identical to the pinned `planar-bam/2` model: old checkpoint semantics and stored
GAE/Adam examples remain unchanged. Nonzero tip loads have new dynamics and must
not inherit old body-pulse evaluation claims. No tire slip or hardware safety
claim is added.

## Less simultaneous information

Chapter 1 uses one real control decision: sensed state → Actor command → actual
wheel force → next state. It shows the decision number/time and a separate live
control counter. The animated scene refreshes faster than the sampled numeric
readout. Raw observations, exact force/moment numbers, costs and force histories
are in expandable sections. Training/test provenance is retained but collapsed
in Live. A button pauses and inspects that live forward pass; it is not falsely
presented as a PPO training sample. Chapters 3–4 clearly switch to recorded
training calculations. Network signs are values, not good/bad scores.

## Verification

`node tests/test_tip.js`: coupled-equation residuals, sign/application point,
zero-tip compatibility, invalid-input atomicity, BAM command response and
explicit strong-load stops. Existing engine suites also run.

`python tests/test_tip_browser.py [--base-url ACTUAL_PAGES_URL]`: real pointer
hold/release, continued inference, impulse accounting, keyboard/accessibility,
cancellation paths, explicit stopping, language-state preservation, live
forward inspection and one actual PPO iteration. It does not mock physics or
policy weights. Event-dispatch cases cover cancellation handlers; ordinary
pointer/keyboard cases use actual browser input.

The earlier walkthrough is retained as an explicitly historical recording,
with its exact source HTML in `archive/en/body-pulse.v2.html`. It is not labelled
as a recording of the new held-force controls.
