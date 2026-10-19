# CartPole Control × Observer Lab

이 페이지는 기존 CartPole PPO Studio의 **동일한 plant 식**을 재사용해 controller와 observer를 독립적으로 교체하며 학습하기 위한 실험장이다.

## 목적

한 번에 한 축만 바꾼다.

\`\`\`text
plant → sensor → observer → estimated state → controller → force → plant
\`\`\`

- Plant: \`src/plant.js\`의 planar BAM/CartPole 물리식 재사용.
- Sensor: 교육용으로 position \`p\`와 pole angle \`θ\`만 직접 측정한다.
- Hidden state: cart velocity \`v\`, pole angular velocity \`ω\`.
- Controller는 simulator truth가 아니라 선택한 observer의 \`x_hat\`을 받는다.
- Truth observer는 oracle upper-bound 진단용이다.

## Controller

### PID
모델 없이 현재 error, derivative, integral에 직접 반응한다. 이 페이지는 balance angle과 cart-position loop를 결합한 educational cascaded PID/PD를 사용한다.

### LQR
upright equilibrium 주변의 선형 모델

\[
x_{k+1}=Ax_k+Bu_k
\]

과 quadratic cost

\[
J=\sum x_k^TQx_k+u_k^TRu_k
\]

에서 Riccati iteration으로 feedback gain을 계산한다.

### MPC
LQR과 같은 local linear model을 사용하지만 horizon을 명시적으로 rollout하고

\[
|u_k|\le u_{max}
\]

를 포함한 bounded sequence를 projected-gradient 방식으로 매 control tick 다시 푼다. 첫 control만 적용한다.

### PPO
기존 \`example_robust.json\`의 final-budget actor를 그대로 사용한다. 새 PPO를 재학습하거나 기존 증거를 재해석하지 않는다.

## Observer

### Raw sensor
\`p, θ\`는 measurement를 그대로 사용하고 \`v, ω\`는 finite difference로 만든다. sensor noise를 미분할 때 왜 문제가 커지는지 보여주는 baseline이다.

### KF
upright linear model을 사용한다.

\[
\hat x^- = A\hat x^+ + Bu
\]

\[
P^- = AP^+A^T+Q
\]

\[
K=P^-H^T(HP^-H^T+R)^{-1}
\]

\[
\hat x^+=\hat x^-+K(y-H\hat x^-)
\]

### EKF
state prediction은 nonlinear \`f(x,u)\`를 사용한다. covariance propagation을 위해 현재 state 주변의 numerical Jacobian

\[
F=\frac{\partial f}{\partial x}
\]

을 사용한다.

### SO(2) invariant-error bridge
angle innovation을

\[
r_\theta=\operatorname{wrap}(\theta_{meas}-\hat\theta)
\]

로 처리한다.

**이 모드는 Hartley contact-aided InEKF의 CartPole 구현이라고 주장하지 않는다.**
CartPole의 angle geometry를 통해 Euclidean EKF → manifold-aware error → humanoid의 SO(3)/SE₂(3) InEKF로 넘어가기 위한 bridge다.

### Learned residual — InNKF-style toy
SO(2)-aware EKF의 posterior를 입력으로 작은 MLP가 남은 residual을 예측한다.

- 10 inputs → 16 tanh hidden → 4 residual outputs.
- train/validation episode는 분리했다.
- validation base residual RMSE: 약 0.1143.
- learned residual RMSE: 약 0.0655.
- training script: \`tools/train_control_observer_residual.js\`.
- artifact: \`artifacts/control_observer_residual.json\`.

이 모델은 InNKF 논문의 TCN + SE₂(3) group generator를 복제한 것이 아니다. **“physics filter + learned posterior residual”이라는 구조를 CartPole에 축약한 educational comparator**다.

### Adaptive R — CoCo/FOCUS bridge
measurement innovation이 비정상적으로 커질 때 reliability를 낮추고 effective measurement covariance \`R\`을 키운다.

\[
R_{eff}=R_0[1+99(1-w)]
\]

이 페이지의 \`w\`는 **학습된 FOCUS/CoCo network가 아니라 innovation-based heuristic**이다. 목적은 다음 개념을 눈으로 확인하는 것이다.

\[
R\uparrow \Rightarrow K\downarrow \Rightarrow measurement\ correction\downarrow
\]

실제 humanoid 연구에서는 이 자리를 learned contact covariance(CoCo-InEKF) 또는 learned FK reliability(FOCUS)가 차지한다.

## Humanoid 논문 계보

1. Hartley et al., Contact-Aided Invariant Extended Kalman Filtering  
   https://arxiv.org/abs/1904.09251
2. Lin et al., Invariant Kalman Filtering and Learned Contact Events  
   https://proceedings.mlr.press/v164/lin22b.html
3. Youm et al., InEKF with Neural Measurement Network  
   https://arxiv.org/abs/2402.00366
4. InNKF, neural compensator  
   https://arxiv.org/abs/2503.00344
5. CoCo-InEKF  
   https://arxiv.org/abs/2605.15122
6. FOCUS  
   https://arxiv.org/abs/2609.02222

## 현재 고정 실험의 의미

\`tests/test_control_lab.js\`의 fixed sensor-noise probe, LQR controller, seeds 1..5:

- Raw finite difference: 5/5 fail.
- KF: 0/5 fail.
- SO(2) bridge state RMSE: 약 0.258.
- Adaptive-R bridge state RMSE: 약 0.109.

measurement-glitch probe:

- SO(2) bridge state RMSE: 약 0.291.
- Adaptive-R bridge state RMSE: 약 0.214.

이 값들은 **이 CartPole educational experiment 안의 paired result**다. FOCUS/CoCo 논문의 숫자나 humanoid 성능으로 승격해서는 안 된다.

## WebMCP

현재 WebMCP producer surface를 feature-detect한다.

\`\`\`js
const mc = document.modelContext || navigator.modelContext;
await mc.registerTool({...});
\`\`\`

등록 도구:

- \`cartpole_get_state\`
- \`cartpole_set_controller\`
- \`cartpole_set_observer\`
- \`cartpole_set_scenario\`
- \`cartpole_apply_push\`
- \`cartpole_reset\`
- \`cartpole_run_steps\`

WebMCP가 없는 브라우저에서도 UI는 정상 동작한다.

현재 API 참고:
- https://developer.chrome.com/docs/ai/webmcp/imperative-api
- https://webmachinelearning.github.io/webmcp/

## Build / run

\`\`\`bash
python3 src/build_control_lab.py
node tests/test_control_lab.js
python3 tests/test_control_lab_browser.py
python3 -m http.server 8765 --bind 0.0.0.0
\`\`\`

브라우저:

\`\`\`text
http://localhost:8765/control-observer-lab.html
\`\`\`

## Claim boundary

이 페이지는 교육용 CartPole 비교기다.

- PID/LQR/MPC/PPO를 일반적 우열 순서로 평가하지 않는다.
- CartPole SO(2) bridge를 humanoid InEKF라고 부르지 않는다.
- Adaptive-R heuristic을 CoCo/FOCUS의 learned estimator라고 부르지 않는다.
- InNKF-style MLP를 논문의 TCN/SE₂(3) implementation이라고 부르지 않는다.
- simulator truth는 observer 성능 평가와 Truth baseline에만 사용한다.
- humanoid state-estimation 결론은 Figure의 별도 matched experiment에서 검증해야 한다.
