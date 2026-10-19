# CartPole Control × Observer Lab v2 — detailed control/estimation bridge

Status: simulation-only educational implementation.

## Provenance

CartPole base:
- tinmanlab/cartpole_PPO
- base revision used for this worktree: 93996b7c76016d3713cb7e81319a75cf1dfddb33
- plant authority reused without a second physics implementation: src/plant.js

Figure/WBMPC architecture reference:
- pinned comparator checkout: manumerous/wb_humanoid_mpc@ab5dbfd1df07a33258ce7f2998f5c315f1fcc8b9
- Figure evidence:
  - docs/evidence/2026-09-18-wb-humanoid-mpc-source-native-admission.md
  - docs/evidence/2026-09-30-centroidal-gpuki-bringup.md
- source files read directly:
  - humanoid_centroidal_mpc/common/CentroidalMpcRobotModel.h
  - humanoid_centroidal_mpc/CentroidalMpcInterface.cpp
  - humanoid_centroidal_mpc/mrt/CentroidalMpcMrtJointController.cpp
  - humanoid_wb_mpc/common/WBAccelMpcRobotModel.h
  - humanoid_wb_mpc/WBMpcInterface.cpp
  - humanoid_wb_mpc/dynamics/WBAccelDynamicsAD.cpp
  - humanoid_wb_mpc/mrt/WBMpcMrtJointController.cpp

No OCS2 or comparator source is copied into the CartPole runtime. The formulations and hierarchy are used as architecture reference.

## What is exact, what is an analogue

| Lab item | Implementation status | Claim boundary |
|---|---|---|
| PID | actual live CartPole controller | local hand-tuned cascaded feedback |
| LQR | actual Riccati state-feedback controller | local upright linear model |
| Linear MPC | actual finite-horizon receding controller | linear model; first-input force clipping, not a general constrained QP solver |
| Centroidal-style MPC | actual reduced-order CoM planner + lower-level state feedback | architecture analogue of Figure centroidal hierarchy, not OCS2 centroidal dynamics |
| Full nonlinear NMPC | actual nonlinear receding-horizon solver using the same CartPole plant in the horizon | SQP/iLQR-style local quadratic iterations, not OCS2 multiple-shooting source |
| PPO | actual pre-trained actor from existing CartPole PPO Studio | no retraining in this lab |
| KF | actual linear Kalman filter | linear model |
| EKF | actual nonlinear mean propagation + local numerical Jacobian | Euclidean error |
| Invariant-error bridge | actual SO(2) wrapped innovation | not Hartley contact-aided InEKF |
| Learned residual | actually trained local residual MLP | structure analogue of InNKF; not its TCN + SE2(3) network |
| Adaptive-R | actual online covariance modulation | heuristic reliability, not learned CoCo/FOCUS |

## Figure centroidal MPC: what was carried over

Pinned source defines

x = [h, q_b, q_j]^T

with normalized centroidal momentum

h = [v_com,x, v_com,y, v_com,z, L_x/m, L_y/m, L_z/m]^T

and input

u = [W_l, W_r, qdot_j]^T.

The OCP uses centroidal dynamics, state/input costs, ICP cost, task-space foot costs, gait/contact schedule, friction/contact constraints and stance/swing constraints. The resulting policy is converted into desired joint states/velocities and contact wrenches; inverse dynamics maps those quantities to feed-forward joint torque.

The CartPole cannot reproduce this formulation literally:
- no two feet,
- no contact wrench decision variables,
- only one horizontal actuator,
- pole is underactuated.

The v2 analogue therefore preserves the hierarchy rather than inventing fake foot variables:

c = x + (m_p l / (m_c+m_p)) sin(theta)

c_dot = v + (m_p l / (m_c+m_p)) cos(theta) omega

c_ddot approximately F / (m_c+m_p).

A finite-horizon reduced MPC predicts (c, c_dot). A look-ahead CoM reference is passed to a full-state inner stabilizer which realizes that plan on the actual nonlinear CartPole.

## Figure full-order NMPC: what was carried over

Pinned source defines

x = [q_b, q_j, qdot_b, qdot_j]^T

and

u = [W_l, W_r, qddot_j]^T.

Full rigid-body acceleration dynamics are inside the optimal-control problem. The source also adds joint-torque cost and contact/swing constraints, then runs an OCS2 SQP/MPC loop and maps the policy to desired joint state plus feed-forward torque.

The CartPole v2 full NMPC uses the corresponding principle:

x = [p, v, theta, omega]

x_(k+1) = f(x_k, u_k)

where f is the same nonlinear CartPole plant used by the live simulation.

At each control tick:
1. warm-start the previous force sequence,
2. nonlinear rollout over N=30,
3. compute numerical stage Jacobians A_k = df/dx and B_k = df/du,
4. solve a local quadratic backward pass,
5. bounded forward line-search with abs(u_k) <= u_max,
6. repeat for at most two iterations,
7. apply only the first force,
8. shift the sequence for the next MPC tick.

This is a genuine nonlinear receding-horizon controller. It is not claimed to reproduce OCS2's sparse multiple-shooting implementation, globalization or exact constraint machinery.

## Shared page architecture

control-observer-lab-v2.html is one stateful application with hash-addressable concept pages.

All pages share the same:
- nonlinear CartPole plant,
- sensor contract,
- live truth/estimate overlay,
- external push controls,
- state graph,
- control graph,
- third context graph,
- controller × observer runtime selectors.

The right lesson panel changes per topic without replacing the live simulation.

Controller topics:
- PID
- LQR
- Linear MPC
- Centroidal-style MPC
- Full nonlinear NMPC
- PPO

Observer/hybrid topics:
- Raw
- KF
- EKF
- InEKF bridge
- Lin
- Youm NMN
- InNKF
- CoCo-InEKF
- FOCUS

The paper topics do not pretend to be executable reproductions when the CartPole lacks the corresponding physical contact structure.

## Visual design reuse

The layout reuses principles rather than source code from the existing tinmanlab teaching viewers.

From cartpole-transformer:
- one authoritative live scene,
- explicit pipeline,
- show only the currently relevant internal calculation.

From cartpole_PPO:
- compact desktop chrome,
- common transport controls,
- paired live/evidence separation,
- no decorative chart that is not backed by runtime state.

From cartpole-diffusion-v02:
- process-oriented explanation rather than a static black-box card.

## WebMCP

The v2 page exposes:
- cartpole_get_state
- cartpole_set_controller
- cartpole_set_observer
- cartpole_set_topic
- cartpole_set_scenario
- cartpole_apply_push
- cartpole_reset
- cartpole_run_steps
- cartpole_run_probe

The offline probe does not mutate the live page state.

## Build and tests

    python3 src/build_control_lab_v2.py
    node tests/test_control_lab_v2.js
    python3 tests/test_control_lab_v2_browser.py

The original PPO engine remains covered by its existing tests.

## Current deterministic evidence

The fixed v2 test verifies:
- all six controller families survive the nominal truth-state probe,
- Centroidal-style MPC survives the nominal and sensor-noise KF probes used by the test,
- Full nonlinear NMPC survives the fixed nominal truth-state probe,
- the full NMPC exposes a 30-step nonlinear horizon and bounded iterative solve,
- the centroidal analogue exposes a 32-step reduced horizon and downstream reference,
- browser WebMCP registration and tool execution work against a mock current producer surface,
- page-level horizontal overflow is absent at the tested desktop viewport.

These are CartPole educational results only.
