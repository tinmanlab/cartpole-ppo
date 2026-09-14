# Third-party sources and retained notices

The original repository license is MIT and remains in [LICENSE](LICENSE). It does **not** remove upstream licenses from adapted code or data. Self-contained built HTML also embeds that adapted code.

| Material | Upstream and notice | Use here |
|---|---|---|
| M6 friction and voltage/back-EMF equations, identified motor parameters | [Rhoban/BAM](https://github.com/Rhoban/bam), Apache-2.0; [retained provenance](vendor/bam/NOTICE.md) | `src/plant.js`, `src/bam_params.js`, `vendor/bam/params/`; embedded in both viewer builds |
| Wheel physical/collision definitions | [ROBOTIS TurtleBot3](https://github.com/ROBOTIS-GIT/turtlebot3), Apache-2.0; [retained provenance](assets/NOTICE.md) | URDF excerpt, sourced radius/mass/inertia. Visual mesh is a local reconstruction, not upstream STL |
| PPO/GAE/Adam theory | [PPO](https://arxiv.org/abs/1707.06347), [GAE](https://arxiv.org/abs/1506.02438), [Adam](https://arxiv.org/abs/1412.6980), [Spinning Up](https://spinningup.openai.com/en/latest/algorithms/ppo.html) | References for the educational local implementation; no paper figures are reproduced |
| Development tools | Node.js, Python, NumPy, Playwright/Chromium, ffmpeg | Tests/build/recording only. These executables and fonts are not distributed in this repository |

Full [Apache-2.0 license text](licenses/Apache-2.0.txt) is included. Source attribution and modification notices are retained in the adapted files. Use the full repository package when redistributing so these notices accompany the standalone viewer.

The screenshots, animated preview and walkthrough are captures of the local app. They are not generated concept art or recordings of a real physical robot.
