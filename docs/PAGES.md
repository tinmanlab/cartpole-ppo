# Hosted interactive simulator

[Open in English](https://tinmanlab.github.io/cartpole_PPO/?lang=en) · [한국어로 실행](https://tinmanlab.github.io/cartpole_PPO/index.html?lang=ko) · [Earlier walkthrough](https://tinmanlab.github.io/cartpole_PPO/docs/demo.html)

These are the running application and video player, not repository source previews. Physics, inference and PPO execute in the visitor's browser; GitHub Pages serves static files. No API key or account is needed.

## One source, online and offline

`python src/build.py` produces English-first `index.html` and compatible `viewer.ko.html` from one engine and bilingual catalogs. These entries are generated distribution files, not independently maintained sources. Pages stages the tested build without rewriting its bytes. For offline use, build once and open either HTML, or save the full hosted HTML.

The original Korean archive remains under `archive/ko/`. The older English viewer is preserved at `archive/en/body-pulse.v2.html` and is checksum-bound to the historical MP4/GIF. The video player explicitly identifies its earlier timed cart-body pulse controls; the current viewer uses held pole-tip input. **Open the interactive lab** on that page opens the current simulator.

## Deployment and evidence

The [workflow](../.github/workflows/verify.yml) has three dependent jobs:

1. Test the engine, generate and check the build, validate package/hosting links, then exercise actual HTTP navigation and held-tip input at a project subpath.
2. Publish only that verified artifact to `github-pages` on `main`. Pull requests never deploy.
3. Open the actual URL returned by deployment and rerun browser interactions there.

Acceptance requires the exact `deployment.json` revision and matching hashes. The tests include language switching without state reset, real physical steps, pointer and keyboard holds with inference continuing, cancellation and explicit stopping, one PPO iteration (2,048 experiences / 64 Adam updates), signed network deltas, replay, working shortcuts and real H.264 playback. CI uses Chrome with codec diagnostics rather than skipping video validation.

[Workflow runs](https://github.com/tinmanlab/cartpole_PPO/actions/workflows/verify.yml) contain logs and the `public-pages-<commit>` artifact: JSON reports and screenshots, including the held-tip scenarios. Pre-deployment failures block publication. A public-test failure is reported after deployment; there is no automatic rollback or robustness claim.
