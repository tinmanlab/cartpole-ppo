# Follow a decision, then run an experiment

## 1. Start with the already-trained example

Open `index.html`. The condition bar tells you three different things: the learner's next training environment, the displayed policy's last training conditions, and the current test environment. The opening policy is a recorded example; **your own learner is still random**.

On **Environment**, move the goal along the track. The cart is not teleported. Its Actor selects left/right stall-force references and the BAM drive model determines the force actually transmitted. Uncheck auto-reset to preserve a failure. Disable the 500-step time cap for uncapped inference; it does not disable angle, position or model-validity stops.

## 2. Read a network without confusing inference and learning

Open **Actor · Critic** and select a neuron. Move through **Inputs → Multiply + sum → tanh → Outputs → Choose force**. Its five input contributions and bias produce one hidden activation. All 16 hidden units compute, not only the highlighted one.

The Actor ends in two logits and softmax probabilities. The Critic ends in a single unbounded value estimate. A Critic value is not an action probability or a predicted step count. The Actor alone selects the action; drawing the Critic in live mode is optional instrumentation, not a required control path.

Use **Activations + weights** to inspect computation and **This update's Δw / Δh** to inspect a recorded change. Blue means positive, orange negative, and purple selection. None means “good policy.” A negative weight is not a failed neuron.

**Live inference** feeds new observations into fixed displayed weights. The ordinary chapter-2 view freezes one recorded experience so chapters 2–4 can use exactly the same data. The scene is clearly labeled *recorded*, not LIVE.

## 3. Separate reward, learning signal and loss

In **Learning signal**, the task scores the next state. Position, velocity and angle costs have different units/scales. The selected experience shows the actual contributions used at collection time.

The Critic predicts discounted future reward. TD error compares the current old-value prediction with reward plus the bootstrapped next old value. GAE includes later TD errors; its target is an **estimate**, not the true future. The Actor uses normalized advantages; the Critic target uses the raw advantage. Their signs can differ after normalization.

A positive training advantage contributes pressure to increase that sampled action's probability. It does not force the final minibatch update to do so: the other samples, clipping, entropy and Adam history also contribute.

## 4. Follow the actual weight update

Open **PPO update** without selecting another experience. The inspection uses the final minibatch of the chosen iteration. Three policies must be distinguished:

| Policy | Meaning |
|---|---|
| Collection policy `π_old` | Frozen while collecting the rollout; its action log probabilities stay fixed across PPO epochs. |
| Before this Adam step | The policy has already changed during earlier minibatches. |
| After this Adam step | The result of this recorded minibatch's averaged gradient and optimizer history. |

Choose a weight and follow **Loss → Backprop → Average · Adam → Inspect change**. Check one sample's gradient against the 128-sample mean. The learning-rate slider in this inspector is a **hypothetical arithmetic calculation** holding gradients/history fixed; it does not retrain or mutate weights.

There is no differentiation through the physical world, the fixed stored actions, old log probabilities, advantages, or target returns.

## 5. Train your own policy

Open **Inference · tests** and press **Start training**. The learner collects 2,048 real transitions per iteration and performs 64 Adam steps across four epochs. A separate Worker runs the training. Completed policies can be sent to the live cart periodically; live simulation time is not the training-iteration clock.

**Finish · freeze** lets an in-progress iteration finish, then freezes its final policy. A low loss is not a success criterion. The nominal evaluation reports survival and a separate balance-plus-goal pass count.

## 6. Change one thing deliberately

Open **Model · conditions**. Controls that cannot affect the selected disturbance profile are disabled. You may still inspect the saved values. Choose a motor, physical settings and cost coefficients, then one of three operations:

| Operation | Preserved | Changed |
|---|---|---|
| Apply to test only | Learner weights, optimizer, training environment | The current scene's physical/reward conditions; scene resets |
| Keep weights · configure continuation | Weights, Adam history and iteration count | Next training environment; curriculum restarts for this segment |
| Create new learner | Existing displayed example and test scene | New random learner with selected conditions |

The latter two **prepare** learning; start it separately in chapter 5. Until the next update, a continued policy still carries its previous last-trained provenance. After continuation, the condition label describes the **last segment**, not its entire history. Checkpoint/experiment notes are needed for full mixed-training provenance.

Cost controls define the task, optimizer controls define the update, and physical controls define the environment. For example, increasing position cost changes the reward on the *same* physical transition; it does not instantly change a fixed policy. Relearning may improve tracking, worsen balance, or do neither—evaluate it.

## 7. Curriculum and disturbances

**Fixed** uses the selected range throughout. **Ramp** increases amplitude-related ranges from 25% to 100% over 100 iterations of the current segment, independent of success. **Success-gated** uses nominal → pushes → sensors → actuator delay/gain → model variation → mixed, advancing only after two consecutive 6/8 passing stage probes. Evaluation occurs every five iterations. It holds on failure; it does not automatically demote or rehearse earlier stages.

Success-gated training is an educational curriculum, not an automatic robust-controller synthesis system. Current observations have no history and no recurrent memory, so hidden dynamics and delay remain important limitations.

## 8. Test a frozen policy, including failure

**Test current policy · 48 trials** freezes the selected weights and uses the current test base specification. Four conditions use 12 held-out seeds each: nominal, configured mixed disturbances, +12 N for 0.20 s at 3 s, and a 1.5× mixed stress condition. The last condition is not a universal definition of OOD.

Read **exposure** before reading recovery: did the trial survive long enough for the push? Was the full pulse delivered? Export JSON for requested/delivered impulse, stop reason and conditional recovery time. Recovery means the state remained within specified position, speed, angle and angular-speed thresholds for 0.5 s after a completed pulse. It is a diagnostic, not a stability proof.

A **model-invalid** stop means the no-slip/contact assumptions were violated. This model does not simulate what happens after tire slip or contact loss. A pole-angle stop and a model-invalid stop are different outcomes.

## Save and switch languages

Save a checkpoint at an iteration boundary. It includes optimizer moments, environment state, noise RNG and delay queues—not just weights. Version 2 refuses earlier physics-version checkpoints instead of silently reinterpreting them. The archived Korean viewer remains available for historical v1 files.

English/Korean translation changes no numerical state, selected experience or learner. Both current entry HTML files are built from the same engine and message catalog. The only browser preference persisted automatically is the language; save your experiment explicitly before reloading.
