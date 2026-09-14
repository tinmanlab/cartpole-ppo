# Hosted interactive simulator

[Open in English](https://tinmanlab.github.io/cartpole_PPO/?lang=en) · [한국어로 실행](https://tinmanlab.github.io/cartpole_PPO/index.html?lang=ko) · [Watch the walkthrough](https://tinmanlab.github.io/cartpole_PPO/docs/demo.html)

These are the running GitHub Pages application and video player, not repository file previews. Physics, inference and PPO learning execute in the visitor's browser. GitHub Pages serves static files; it does not run a remote learning service. No API key or account is needed.

## One source, online and offline

The site serves the verified `index.html` and `viewer.ko.html` bytes without modifying them. Both languages use the same physics and learning engine. The original Korean archive remains preserved under `archive/ko/`. The recorded MP4 and GIF are deployed with the viewer, not reconstructed into a different demonstration.

For offline use, download the repository and open `index.html`. On the hosted walkthrough page, **Open the interactive lab** returns to the actual simulator.

## Deployment and evidence

The existing [verification workflow](../.github/workflows/verify.yml) now has three dependent jobs:

1. Verify the engine, build consistency, package links and hosting contract; test the staged site through real HTTP navigation at a project subpath.
2. Publish only the verified Pages artifact to the `github-pages` environment on `main`. Pull requests never deploy.
3. Open the actual URL returned by the deployment action and rerun browser interactions there.

The live checks require the exact `deployment.json` revision and compare viewer, archive and media hashes. They exercise language switching without resetting numerical state, real simulation steps, target control, external force, a PPO iteration (2,048 experiences / 64 Adam updates), signed network deltas, replay, and actual video playback. The browser must decode the supplied H.264 MP4; CI uses branded Chrome and records codec support rather than silently skipping video tests.

[Latest workflow runs](https://github.com/tinmanlab/cartpole_PPO/actions/workflows/verify.yml) contain the logs and `public-pages-<commit>` evidence artifact with a JSON report and screenshots. Pre-deployment failures block deployment. A public smoke-test failure is reported separately after deployment; it is not an automatic rollback or a performance/robustness claim.

`deployment.json` identifies the deployed revision and file checksums. A successful upload alone does not establish that the public URL runs. The live smoke test is the acceptance check.
