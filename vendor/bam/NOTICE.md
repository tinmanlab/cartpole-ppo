# Rhoban / Better Actuator Models (BAM)

Upstream: https://github.com/Rhoban/bam
Pinned commit: e9a619d56da5236206f4de6ceec2c1ee1b497b5c
License: Apache License 2.0; see ../../licenses/Apache-2.0.txt (package root licenses/).
Copyright 2025 Marc Duclusaud & Grégoire Passault.

The three JSON files in params/ are preserved byte-for-byte from:
- bam/params/xl330/m6.json, Git blob 6100eb7cde6d6953a3a42086124a8c9e277137c4
- bam/params/mx64/m6.json, Git blob 1a37d029d40fb47d8bf00a725b79e94386cbef4f
- bam/params/mx106/m6.json, Git blob 39b8d70f87d3e8bc67a9de9969c7796a04bffc51

Adapted source equations:
- bam/model.py: Model.compute_frictions for the M6 model.
  Git blob 902898ff5e396bb5742e6c8fc04a48711e2d9e67
- bam/actuator.py: VoltageControlledActuator.compute_torque.
  Git blob 5c45e94545253698df84e55d6096490b429eaaf8

Modifications: scalar JavaScript implementation in src/plant.js, electrical
voltage-to-torque equation, and load-dependent/Stribeck/quadratic friction budget.
Source formulas are evaluated against an independent NumPy implementation over
3,000 cases. This does NOT validate the surrounding cart plant or real hardware.

Local additions, not supplied by or approved by BAM:
- force-reference-to-PWM adapter, supply setpoints (5 V / 12 V), wheel speed-up;
- reflected inertia and reduced, constrained cart dynamics;
- scalar, fixed-step friction solve and extra queue/lag/randomization;
- UI, PPO implementation, curriculum and instructional examples.

No firmware P-position controller is ported. No Python BAM or MuJoCo runtime is
embedded. The fitted q_offset and rig-specific command_delay are retained in the
source data but not silently applied to the wheel adapter. User-added transport
and command lag are separate simulation parameters. No current, thermal,
battery-sag, hardware communication or safe-operating-area guarantees are made.

Reference: Marc Duclusaud, Grégoire Passault, Vincent Padois, Olivier Ly,
"Extended Friction Models for the Physics Simulation of Servo Actuators",
ICRA 2025, pp. 12091–12097. See https://bam.readthedocs.io/en/latest/.
