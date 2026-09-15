# Robust PPO v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate, inspectable robust PPO training path with continuous control, short observation/action history, an asymmetric critic, authority-normalized pole-tip/body disturbances, performance-gated adaptive curriculum, and a quantitative robustness envelope.

**Architecture:** Preserve the current discrete legacy PPO path and `planar-bam/2` semantics. Robust PPO v2 lives in new focused modules and calls the same CartPole/BAM plant through a new continuous-action entry point. A separate Worker trains/evaluates robust policies, while Chapter 5 adds one collapsed robust experiment panel and reuses the existing replay surface.

**Tech Stack:** Browser JavaScript, Web Worker, standalone generated HTML, Node-based numerical tests, Python/Playwright browser tests, GitHub Pages CI.

**Spec:** `docs/superpowers/specs/2026-09-15-robust-ppo-v2-design.md`

## Global Constraints

- Legacy `Trainer`, `CartPole.step(action)` and v2 checkpoints must remain semantically unchanged.
- No backend, database, GPU requirement, external runtime dependency, RARL, tire-slip model or hardware-safety claim.
- Robust Actor: history `5 × (obs5 + previous_action) = 30` inputs, `30→32→2` Gaussian output.
- Robust Critic: actor history + 14 privileged training-only values = 44 inputs, `44→64→1`.
- Rollout: 16 env × 128 steps = 2,048 transitions; 4 epochs; minibatch 128; 64 updates/iteration.
- Robust v2 uses a new checkpoint schema and never reinterprets legacy v2 checkpoints.
- Pole-tip curriculum uses actuator-relative authority ratios; authority `>1` is stress/OOD, not a promotion target.
- Chapter 5 remains the only robust UI entry; do not add a second animated CartPole.

---

### Task 1: Continuous-action plant entry point

**Files:**
- Modify: `src/core.js`
- Create: `tests/test_robust_v2.js`
- Modify: `tools/test.js`

**Interfaces:**
- Produces: `CartPole.prototype.stepContinuous(action:number, externalForce?:number, tipForce?:number)`.
- Produces: `CartPole.prototype._stepCommand(command:number, externalForce:number, tipForce:number)` internal common path.
- Legacy `step(action)` continues accepting only `0|1`.

- [ ] **Step 1: Write failing tests for exact action mapping and legacy parity**

```js
const assert=require('node:assert/strict');
const E=require('../src/core');
const P=require('../src/plant');

const spec=P.validateSpec({actuator:'ideal',force:8});
const a=new E.CartPole(new E.RNG(11),{spec,seed:22});
const b=new E.CartPole(new E.RNG(11),{spec,seed:22});
assert.deepEqual(a.s,b.s);
const d=a.step(1,0,0);
const c=b.stepContinuous(1,0,0);
assert.deepEqual(a.s,b.s);
assert.equal(d.command,8);
assert.equal(c.command,8);

const z=new E.CartPole(new E.RNG(13),{spec,seed:24});
const out=z.stepContinuous(0,0,0);
assert.equal(out.command,0);
assert.throws(()=>z.stepContinuous(1.00001));
```

- [ ] **Step 2: Run test and confirm RED**

Run: `node tests/test_robust_v2.js`
Expected: FAIL because `stepContinuous` does not exist.

- [ ] **Step 3: Factor the existing physical step behind `_stepCommand`**

Implementation shape:

```js
_stepCommand(command, externalForce=0, tipForce=0) {
  if (this.done) throw Error('Reset terminated environment.');
  if (![command,externalForce,tipForce].every(Number.isFinite)) throw Error('Invalid command or external force.');
  // existing delay/gain/BAM/integrate/reward/termination body, using command directly
}
step(action, externalForce=0, tipForce=0) {
  if (action!==0 && action!==1) throw Error('Action must be 0 or 1.');
  return this._stepCommand((action?1:-1)*this.spec.force, externalForce, tipForce);
}
stepContinuous(action, externalForce=0, tipForce=0) {
  if (!Number.isFinite(action) || action < -1 || action > 1) throw Error('Continuous action must be in [-1,1].');
  return this._stepCommand(action*this.spec.force, externalForce, tipForce);
}
```

- [ ] **Step 4: Run robust test plus legacy suites**

Run: `node tests/test_robust_v2.js && node tools/test.js`
Expected: PASS; legacy zero-tip/discrete parity tests remain green.

- [ ] **Step 5: Commit**

```bash
git add src/core.js tests/test_robust_v2.js tools/test.js
git commit -m "feat: add continuous CartPole action path"
```

---

### Task 2: Gaussian Actor math, history and asymmetric critic input

**Files:**
- Create: `src/robust_v2.js`
- Extend test: `tests/test_robust_v2.js`
- Modify: `src/build.py`

**Interfaces:**
- Produces: `RobustV2.gaussianPolicy(model,input,deterministic,rng)`.
- Produces: `RobustV2.gaussianLoss(output,storedZ,oldLogp,adv,epsilon,entropyCoef)`.
- Produces: `RobustV2.HistoryBuffer` with `input()` and `append(obs,action)`.
- Produces: `RobustV2.privilegedInput(env,historyInput,cartForce,tipForce)` returning 44 finite values.

- [ ] **Step 1: Add finite-difference tests for Gaussian log-prob gradients**

Use fixed `mu=0.17`, `logStd=-0.6`, `z=-0.21`, `adv=0.8`, `oldLogp=currentLogp-0.03`; compare analytic `dL/dmu` and `dL/dlogStd` to central differences with `h=1e-6`, tolerance `2e-6`.

- [ ] **Step 2: Add exact history tests**

```js
const h=new R.HistoryBuffer([1,2,3,4,5],5);
assert.equal(h.input().length,30);
assert.deepEqual(h.input().slice(0,6),[1,2,3,4,5,0]);
h.append([6,7,8,9,10],.25);
assert.deepEqual(h.input().slice(-6),[6,7,8,9,10,.25]);
```

- [ ] **Step 3: Add privileged-input tests**

Assert length 44, all finite, and verify the actor history prefix exactly equals `history.input()`. Change hidden mass/gain/disturbance values and assert only privileged suffix changes.

- [ ] **Step 4: Implement robust policy primitives**

Key equations:

```js
sigma=Math.exp(clamp(logStd,-3,.5));
z=deterministic?mu:mu+sigma*rng.normal();
u=Math.tanh(z);
logp=-.5*((z-mu)/sigma)**2-log(sigma)-.5*log(2*Math.PI)-Math.log(1-u*u+1e-6);
```

For stored `z`:

```js
dlogp_dmu=(z-mu)/(sigma*sigma);
dlogp_dlogstd=((z-mu)*(z-mu)/(sigma*sigma)-1) * clampGradient;
```

Multiply by the PPO surrogate derivative and backpropagate `[dL/dmu,dL/dlogStd]` through the existing generic `MLP.backward`.

- [ ] **Step 5: Include `robust_v2.js` in CORE build after `core.js`**

`src/build.py` CORE order becomes:

```python
('bam_params.js', 'plant.js', 'core.js', 'robust_v2.js')
```

- [ ] **Step 6: Run numerical tests and build**

Run: `node tests/test_robust_v2.js && python src/build.py && python src/build.py --check`
Expected: finite-difference and history/privileged tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/robust_v2.js src/build.py tests/test_robust_v2.js
git commit -m "feat: add robust Gaussian policy and asymmetric inputs"
```

---

### Task 3: Authority-normalized disturbance scheduler and adaptive curriculum

**Files:**
- Modify: `src/robust_v2.js`
- Extend test: `tests/test_robust_v2.js`

**Interfaces:**
- Produces: `RobustV2.availableWheelForce(spec,params)`.
- Produces: `RobustV2.tipForceForAuthority(spec,params,ratio)`.
- Produces: `RobustV2.tipAuthorityRatio(spec,params,tipForce)`.
- Produces: `RobustV2.DisturbanceSchedule`.
- Produces: `RobustV2.AdaptiveBoundary`.

- [ ] **Step 1: Write authority monotonicity tests**

For XL330 at default gearing assert:

```js
ratio(0)===0
ratio(0.1)>0
ratio(0.2)>ratio(0.1)
abs(ratio(tipForceForAuthority(.35))-.35)<1e-6
```

Change gear ratio/actuator and assert Newton force at the same ratio changes while the requested ratio remains unchanged.

- [ ] **Step 2: Write deterministic mixture/schedule tests**

Generate 1,000 episode schedules with a fixed RNG. Assert exact seeded family counts against a stored snapshot and verify every event starts no earlier than 0.30 s; tip impulse/hold ratios never exceed the current boundary.

- [ ] **Step 3: Write curriculum threshold tests**

```js
const c=new R.AdaptiveBoundary();
c.grade({nominal:7,tip:6,mixed:6,count:8}); // streak 1, level 0
c.grade({nominal:8,tip:7,mixed:6,count:8}); // promote to level 1
c.grade({nominal:8,tip:3,mixed:7,count:8}); // contract to level 0
```

- [ ] **Step 4: Implement authority and schedule sampling**

Use the spec mixture exactly: 30% nominal, 25% tip impulse, 10% tip hold, 15% body impulse, 20% mixed. Physical parameters are per-episode; observation noise remains per-step.

- [ ] **Step 5: Implement performance-gated expansion/contraction**

Boundary levels are `[.10,.20,.35,.50,.65,.80]`; two consecutive promotion gates; contract when tip or mixed `<4/8` above level zero.

- [ ] **Step 6: Run tests**

Run: `node tests/test_robust_v2.js`
Expected: authority/schedule/curriculum tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/robust_v2.js tests/test_robust_v2.js
git commit -m "feat: add authority-based disturbance curriculum"
```

---

### Task 4: RobustTrainer, asymmetric critic and v1 robust checkpoints

**Files:**
- Modify: `src/robust_v2.js`
- Extend test: `tests/test_robust_v2.js`

**Interfaces:**
- Produces: `new RobustV2.Trainer(seed,hp)`.
- Produces methods: `collect()`, `optimize(data)`, `iteration()`, `gate()`, `snapshot()`, `checkpoint()`.
- Produces: `RobustV2.restoreTrainer(checkpoint)`.

- [ ] **Step 1: Write trainer-shape and real-update tests**

Assert default actor `n=30,h=32,o=2`, critic `n=44,h=64,o=1`; one iteration collects exactly 2,048 samples and performs 64 Adam steps per network; at least one actor parameter changes.

- [ ] **Step 2: Write actor/critic information-boundary test**

For two environments with identical sensed history but different hidden mass/gain, assert actor inputs identical and critic inputs different.

- [ ] **Step 3: Write reward regularization tests**

At the same next state, verify `u=0` has lower action cost than `u=.8`; changing from previous action `-.8` to `.8` incurs higher rate cost than remaining near previous action.

- [ ] **Step 4: Implement rollout collection**

Each environment owns:

```js
{ env: CartPole, history: HistoryBuffer, schedule: DisturbanceSchedule, prevAction:number }
```

At each step calculate scheduled body/tip force, actor input, stochastic action, privileged critic input, `stepContinuous`, robust reward and next-value target.

- [ ] **Step 5: Implement PPO optimization**

Use normalized GAE, 4 shuffled epochs, minibatch 128, exact Gaussian policy gradients, critic MSE gradients, global norm 0.5 and Adam. Defaults: actor LR `3e-4`, critic LR `1e-3`, entropy `0.002`.

- [ ] **Step 6: Implement gate evaluation with independent seeds**

Every fifth iteration evaluate nominal/current-tip/current-mixed families with 8 trials each and call `AdaptiveBoundary.grade`.

- [ ] **Step 7: Implement checkpoint round-trip**

Checkpoint schema `cartpole-robust-v2-checkpoint/v1`; include RNGs, env state, histories, schedules, boundary state and optimizer tensors. Restore then compare the next collection/update within the same runtime.

- [ ] **Step 8: Run tests**

Run: `node tests/test_robust_v2.js && node tools/test.js`
Expected: robust trainer and all legacy suites PASS.

- [ ] **Step 9: Commit**

```bash
git add src/robust_v2.js tests/test_robust_v2.js
git commit -m "feat: implement Robust PPO v2 trainer"
```

---

### Task 5: Robustness envelope and separate Worker protocol

**Files:**
- Create: `src/robust_worker.js`
- Modify: `src/robust_v2.js`
- Extend test: `tests/test_robust_v2.js`
- Modify: `src/build.py`
- Modify: `src/shell.html`

**Interfaces:**
- Produces: `RobustV2.evaluateEnvelope(snapshot,options)`.
- Worker accepts `init`, `iterate`, `evaluateEnvelope`, `checkpoint`, `restore`.
- Worker emits `ready`, `phase`, `result`, `gate`, `envelopeProgress`, `envelope`, `checkpoint`, `error`.

- [ ] **Step 1: Write envelope shape/OOD-label tests**

Assert a reduced test envelope with ratios `[0,.5,1,1.25]` and durations `[.05,.2]` produces 8 cells; `ratio=1.25` cells have `stressOOD===true`; every cell reports success/model-invalid/max-angle/max-error/recovery/saturation fields.

- [ ] **Step 2: Implement envelope evaluation**

Use separate final-test seeds from training/gate seeds. Generate tip pulses from requested authority ratio using the current actuator/gearing. Stop and classify model-invalid outcomes rather than simulating unsupported slip/flight.

- [ ] **Step 3: Add robust worker source to standalone shell/build**

Add:

```html
<script id="robustWorkerSource" type="text/plain">/* ROBUST_WORKER */</script>
```

and replace the marker from `src/build.py`.

- [ ] **Step 4: Add a Node worker-contract smoke test**

Instantiate `RobustV2.Trainer`, serialize one record using the same helper as worker, verify no non-finite values and checkpoint restore.

- [ ] **Step 5: Run tests/build**

Run: `node tests/test_robust_v2.js && python src/build.py && python src/build.py --check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/robust_worker.js src/robust_v2.js src/build.py src/shell.html tests/test_robust_v2.js
git commit -m "feat: add robust envelope worker"
```

---

### Task 6: Chapter 5 Robust PPO v2 educational UI

**Files:**
- Create: `src/robust_ui.js`
- Modify: `src/build.py`
- Modify: `src/interaction.css`
- Modify: `locales/interaction.json`
- Create: `tests/test_robust_browser.py`

**Interfaces:**
- Adds a single collapsed `Robust PPO v2` section to Chapter 5.
- Reuses existing `#world` animation and existing replay surface; no second simulator.

- [ ] **Step 1: Write browser test before UI implementation**

Test requirements:

```python
assert page.locator('#world').count() == 1
page.click('[data-chapter="5"]')
page.locator('#robustV2 summary').click()
assert 'Continuous action' in page.locator('#robustMethod').inner_text()
page.click('#robustOneIteration')
page.wait_for_function('RobustUI.status().latestIteration === 1')
assert page.evaluate('RobustUI.status().transitions') == 2048
```

Also switch EN→KO→EN and assert robust boundary/iteration state unchanged.

- [ ] **Step 2: Run browser test and confirm RED**

Run: `python src/build.py && python tests/test_robust_browser.py`
Expected: FAIL because robust UI does not exist.

- [ ] **Step 3: Implement one collapsible robust panel**

Show only:

- method: `continuous Gaussian · 5-step history · asymmetric critic`;
- current boundary: ratio + approximate Newton tip range;
- latest gate: nominal/tip/mixed pass counts;
- `1 iteration`, `train 20`, `stop`, `evaluate envelope`, checkpoint buttons;
- compact envelope table/heatmap.

All detailed formulas remain in the existing notes/docs; do not add another dashboard.

- [ ] **Step 4: Implement envelope heatmap semantics**

Rows = duration; columns = authority ratio. Cell text = success/trials. Model-invalid adds a neutral hatch/label. Ratios `>1` have explicit `STRESS / OOD` header, never green “passed” semantics.

- [ ] **Step 5: Add bilingual strings**

Add matching EN/KO keys to `locales/interaction.json`; build must reject key/placeholder mismatch.

- [ ] **Step 6: Run browser and package tests**

Run:

```bash
python src/build.py
python tests/test_robust_browser.py
python tests/test_bilingual.py
python tools/check_package.py
```

Expected: one simulator, real robust update, language state preservation, no runtime requests/errors.

- [ ] **Step 7: Commit**

```bash
git add src/robust_ui.js src/build.py src/interaction.css locales/interaction.json tests/test_robust_browser.py
git commit -m "feat: expose robust PPO experiment panel"
```

---

### Task 7: Fixed-budget multi-seed robustness experiment and documentation

**Files:**
- Create: `tools/evaluate_robust_v2.js`
- Create: `evidence/robust_v2_experiment.json`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `docs/MODEL.md`
- Modify: `docs/VERIFICATION.md`
- Modify: `docs/TIP_FORCE.md`

**Interfaces:**
- Experiment compares legacy nominal policy and Robust PPO v2 at declared fixed budgets and independent test seeds.

- [ ] **Step 1: Implement deterministic experiment script**

Run at least three robust training seeds (`123,456,789`) with a fixed declared iteration budget. Evaluate nominal plus in-range authority cells and stress/OOD cells. Store every seed/cell, not only aggregate winners.

- [ ] **Step 2: Run experiment and inspect failures**

Run: `node tools/evaluate_robust_v2.js`
Expected: JSON includes training budget, seeds, boundary reached, nominal success, envelope cells, model-invalid counts and no best-checkpoint cherry-picking unless explicitly labelled validation selection.

- [ ] **Step 3: Apply acceptance gate**

Do not claim robustness improvement unless the fixed-budget result satisfies:

- no material nominal collapse versus the declared baseline;
- at least one in-range tip or mixed condition improves across aggregate seeds;
- stress/OOD remains labelled separately.

If the gate fails, keep the implementation experimental and document the failure rather than retuning silently.

- [ ] **Step 4: Update docs**

README summary must distinguish:

`legacy discrete learner` vs `Robust PPO v2 experimental learner`.

Document continuous action, history, asymmetric critic, adaptive boundary and authority-ratio interpretation. Explicitly state that 12 N pole-tip force can be physically outside available authority.

- [ ] **Step 5: Run full static/numerical/browser suite**

Run:

```bash
node tools/test.js
python src/build.py
python src/build.py --check
python tools/check_package.py
python tests/test_bilingual.py
python tests/test_browser_bam.py
python tests/test_robust_browser.py
```

Expected: PASS; archive/checkpoint compatibility still intact.

- [ ] **Step 6: Commit**

```bash
git add tools/evaluate_robust_v2.js evidence/robust_v2_experiment.json README.md README.ko.md docs/MODEL.md docs/VERIFICATION.md docs/TIP_FORCE.md
git commit -m "docs: report Robust PPO v2 robustness envelope"
```

---

### Task 8: PR, CI and exact-head review

**Files:**
- No new production files unless CI/review finds a defect.

- [ ] **Step 1: Push `feat/robust-ppo-v2` and open a PR against `main`**

PR title: `Add authority-gated Robust PPO v2 training`

PR body must state:

- legacy path preserved;
- continuous/historical robust method added;
- exact fixed-budget robustness result;
- unresolved stress/OOD failures;
- no 12 N pole-tip success claim.

- [ ] **Step 2: Wait for exact-head Actions**

Required jobs: engine/build, browser tests, Pages-compatible packaging. Do not use prior-commit success.

- [ ] **Step 3: Review affected semantics**

Check:

- continuous action shares BAM path without double-counting inertia;
- history has no future leakage;
- actor cannot see privileged critic variables;
- gate/test seeds are distinct;
- model-invalid cases are not counted as recoverable failures or hidden successes;
- legacy checkpoints/examples remain readable;
- Chapter 5 still has one animated CartPole.

- [ ] **Step 4: Merge only after technical verdict and checks are clean**

After merge, confirm the GitHub Pages deployment serves the merged revision and run hosted robust-panel smoke tests before describing it as deployed.
