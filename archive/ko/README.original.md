# CartPole PPO BAM Studio

## 실행
`cartpole_ppo_bam_studio.html` 하나를 PC 브라우저로 열어 실행합니다. 외부 JS,
서버, 계정, API key가 필요하지 않습니다. UI는 데스크톱용입니다.

첫 장면은 이번 BAM 엔진으로 새로 학습한 내장 XL330 예제를 실행합니다.
‘내 학습기’는 별도 무작위 I.0으로 준비됩니다. 예제를 보고 있다고 내 학습기가
학습 완료된 것이 아닙니다. 이전 Step Studio의 가중치/성공률을 이식하지 않았습니다.

## 설정의 적용 위치
상단 세 칸은 (1) 다음 수집에 사용할 내 학습 조건, (2) 화면 정책의 마지막 학습
조건, (3) 현재 Live 시험 조건입니다. 차이가 있으면 경고를 표시합니다.

‘BAM · 조건 설정’에서 구동기, 물리량, 외란 범위를 바꾼 것만으로는 적용되지 않습니다.
- 시험에만 적용: 시험만 새로 시작. 학습기·가중치·Adam은 변경하지 않음.
- 이 조건으로 새 학습기: 확인 후 내 가중치·기록 초기화. 무작위부터 시작.
- 가중치 유지 · 이어 학습 설정: 현재 iteration 종료 후 사용. 가중치·Adam 유지,
  다음 rollout부터 조건 변경. 시험 장면은 따로 적용해야 함.

설정 후 5장에서 ‘학습 시작’을 누릅니다. 조건 변경만으로 자동 학습은 시작되지
않습니다. ‘화면 정책 조건으로 시험’은 그 정책의 실제 기록된 물리 조건을 읽어
시험 환경에 적용합니다. 이 버튼도 재학습하지 않습니다.

## Actuator와 wheel
이상적 힘 비교용 + XL330 / MX64 / MX106을 선택합니다. 세 servo는 upstream
BAM M6 식별 JSON을 그대로 사용합니다. M6 마찰 budget, kt/R/back-EMF 식,
rotor armature를 JavaScript 계산에 연결했습니다. Python BAM 런타임을 실행하거나
servo firmware 전체를 재현한 것은 아닙니다. 상세 출처는 vendor/bam/NOTICE.md.

Actor 출력은 여전히 2개 선택입니다. 좌/우 정지힘 기준 명령을 로컬 PWM 어댑터가
전압으로 바꾸고, 실제 토크는 속도·역기전력·마찰에 따라 달라집니다. 바퀴 반지름,
추가 속도증대비, 회전관성을 거쳐 수평 힘으로 연결합니다. 2개 구동 바퀴를 가정합니다.

기본 명령은 ±8 N 기준입니다. ±12 N 기준에서는 200 Hz 세부 step의 접촉력 상한
검사로 모델 유효범위를 넘는 경우가 많아, 명령을 ±8 N으로 낮췄습니다. μ를 늘리거나
실패 검사를 끄지 않았습니다. 이것은 외력 12 N 대응을 보장한다는 뜻이 아닙니다.

ROBOTIS TurtleBot3 wheel의 radius=33 mm, width=18 mm, mass=28.50 g,
rolling I=2.0712558e-5 kg m²를 사용합니다. 원본 STL은 다운로드 실패했으므로
외관은 해당 치수로 재구성한 경량 mesh입니다. 자세한 구분은 assets/NOTICE.md.
Live의 ‘BAM 구동부’ 펼치기에서 확대된 wheel과 전압/토크/마찰/전달력을 봅니다.

## 커리큘럼
고정: 선택한 요인만 지정한 범위에서 학습.
램프: 해당 학습 구간의 첫 iteration에서 25%, 100 iterations 후 100%.
성과 기반: 기본 → 밀침 → 센서 → 명령지연/모터변동 → 질량/길이/마찰 → 복합.
5 iterations마다 그 단계에서 8회 시험. 6/8 이상을 두 번 연속 통과하면 승급;
미달이면 유지합니다. 단일 요인 단계는 다른 요인을 꺼 두고, 마지막 복합 단계에서
동시에 적용합니다. 자동 하향·망각방지 rehearsal은 구현하지 않았습니다.
승급용 seed는 의사결정에 사용하므로 최종 독립 검증으로 간주하지 않습니다.

학습 그래프는 해당 actuator/기준 질량에서 외란 없는 nominal 평가입니다.
복합·12 N·OOD 검사는 5장 ‘실제 재검증’에서 별도로 수행합니다. 테스트에만
바람을 넣는 것과 학습 중 바람을 경험하는 것은 다릅니다. 모든 물리적 조건의
강인성을 보장하지 않습니다. 범위 한계는 각 입력란에 표시됩니다.

## 신경망 보기
2장의 ‘활성값 + 실제 가중치’에서는 입력에 따른 실제 h값과 w를 표시합니다.
‘현재 추론을 실시간으로’는 Live 카트의 입력을 사용합니다. 이 보기 자체는 학습하지
않습니다. 선택 경험 보기로 돌아오면 같은 고정 경험을 3·4장에서 계속 설명합니다.
‘이번 업데이트 Δw / Δh’는 마지막 실제 minibatch 전후 차이입니다. 출력에 전후
숫자를 함께 표시합니다. 값의 부호는 파랑(+)/주황(−), 선택은 보라 점선입니다.
색은 성능 점수가 아닙니다. |w| ≥ 1은 진하기 상한으로 표시합니다. Δ는 각 네트워크의
최대 절댓값으로 독립 스케일링되므로 색 진하기를 iteration 사이의 절대 크기로
비교하면 안 됩니다. 실제 값은 데이터/확대 계산에서 확인합니다.

## 모델 경계
정책 50 Hz, 물리 200 Hz, 1D constrained cart와 무미끄럼 rolling 모델입니다.
wheel 회전/rotor armature는 병진에 반영합니다. 마찰 원뿔의 단순 근사 |F|≤μMg가
어느 물리 substep에서든 깨지면 ‘모델 유효범위 초과’로 종료합니다. 이는 tire-slip을
시뮬레이션했다는 뜻이 아닙니다. 차체 pitch/yaw/하중전달, tire 접촉변형, 배터리·열,
전류 제한, hardware watchdog, 센서 이력/RNN 및 연속 action은 포함하지 않습니다.
실제 로봇에 연결하는 제품이나 하드웨어 안전 검증이 아닙니다.

## 재현
Python 3, Node.js 및 Playwright+Chromium(브라우저 검증용)이 필요합니다.
엔진은 Node에서 실행하는 것과 HTML Worker에서 실행하는 것이 동일합니다.

```
python src/build.py
node tests/test_bam.js
node tests/test_integration.js
node tests/test_lesson.js
python tests/reference_parity.py
python tests/test_browser_bam.py
```

내장 예제 재생성: `node generate_examples.js nominal`, `node generate_examples.js robust`.
둘 다 seed 123, 120 iterations이며 최상 결과를 골라내지 않고 고정 마지막 정책을
사용합니다. SHA와 이번 실측 결과는 VERIFICATION_KO.md / evidence/를 확인하세요.
checkpoint는 BAM 전용 schema입니다. 이전 엔진 checkpoint는 명시적으로 거부합니다.
