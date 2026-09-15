// One force owner per physical pointer/key. No timers, no synthesized click,
// and no second policy. Only physics() consumes the force at a control tick.
const HOLD = { owners: new Map(), policyCalls: 0, appliedSeconds: 0, impulse: 0 };
function heldForce() {
    const direction = clip([...HOLD.owners.values()].reduce((a, b) => a + b, 0), -1, 1);
    return direction * +$('pushForce').value;
}
function beginHold(owner, direction) {
    if (isSample() || S.mode !== 'live' || S.paused || S.hidden || S.env.done || $('conditions').open || $('notes').open) {
        toast(tr('tip.notRunning'));
        return false;
    }
    if (!HOLD.owners.size) { HOLD.appliedSeconds = 0; HOLD.impulse = 0; }
    HOLD.owners.set(owner, direction);
    updateControlStatus();
    return true;
}
function releaseHold(owner) {
    if (owner === undefined) HOLD.owners.clear();
    else HOLD.owners.delete(owner);
    if (S.env) updateControlStatus();
}
function updateControlStatus() {
    const el = $('controlStatus');
    if (!el || !S.env) return;
    const recorded = isSample() || S.mode === 'replay';
    el.hidden = recorded;
    const ended = S.env.done, active = !ended && !S.paused && !S.hidden && !recorded;
    const cause = ended ? (S.env.validityLimit ? 'tip.stopModel' : S.env.truncated ? 'tip.stopTime' : Math.abs(S.env.s[0]) > 2.4 ? 'tip.stopTrack' : 'tip.stopAngle') : S.hidden ? 'tip.hidden' : S.paused ? 'tip.paused' : 'tip.running';
    el.className = 'control-status' + (ended ? ' stopped' : active ? ' active' : '');
    el.textContent = tr(cause) + ' · ' + tr('tip.ticks', HOLD.policyCalls) + ' · ' + tr('tip.applied', F(heldForce(), 2), F(HOLD.appliedSeconds, 2));
    for (const [id, dir] of [['pushLeft', -1], ['pushRight', 1]]) {
        const b = $(id), pressed = Math.sign(heldForce()) === dir;
        b.classList.toggle('held', pressed); b.setAttribute('aria-pressed', String(pressed));
        // Do not disable a held element: browsers could swallow pointerup.
        b.setAttribute('aria-disabled', String(!active));
    }
}
function renderEnvironment() {
    $('lessonTitle').textContent = tr('tip.lessonTitle');
    $('lessonSubtitle').textContent = tr('tip.lessonSub');
    $('lessonBody').innerHTML = `<h2 class="question">${tr('tip.question')}</h2><p class="causal-lead">${tr('tip.lead')}</p>
      <div id="decisionChain" class="decision-chain"></div>
      <section class="decision-result"><b>${tr('tip.response')}</b><div id="decisionResult"></div><p class="inline-note">${tr('tip.notSuccess')}</p></section>
      <button id="inspectLiveDecision" class="outline">${tr('tip.inspect')}</button>
      <details class="input-detail"><summary>${tr('tip.inputs')}</summary><table class="values"><thead><tr><th>${tr('tip.quantity')}</th><th>${tr('tip.actual')}</th><th>${tr('tip.measured')}</th><th>${tr('tip.scaled')}</th></tr></thead><tbody id="observationRows"></tbody></table></details>
      <p class="inline-note">${tr('tip.boundary')}</p>`;
    $('inspectLiveDecision').onclick = () => { releaseHold(); S.paused = true; S.netLive = true; setChapter(2); };
    $('support').className = 'support single';
    $('support').innerHTML = `<details class="force-detail"><summary>${tr('tip.exact')}</summary>
      <p>${tr('tip.mechanics')}</p><pre>Qₓ = F_cart + F_tip
Qθ = 2l cos(θ) F_tip
(M + m) ẍ + ml cos(θ) θ̈ = F_contact + F_cart + F_tip − b ẋ + ml θ̇² sin(θ)
(4/3) ml² θ̈ + ml cos(θ) ẍ = mgl sin(θ) + 2l cos(θ) F_tip</pre>
      <p class="inline-note">${tr('tip.units')}</p><div id="forcePath" class="flow-row"></div>
      <canvas id="forceTrace" height="145"></canvas><p class="inline-note">${tr('tip.traceKey')}</p>
      <p>${tr('tip.costExplanation')}</p></details>`;
    updateEnvironment();
}
function updateEnvironment() {
    if (S.chapter !== 1 || !$('decisionChain')) return;
    const f = scene(); if (!f) return;
    const o = f.obs, sensed = [f.goal - o[0] * 2.4, o[1] * 2.5, o[2] * Math.PI / 15, o[3] * 2.5, f.goal], actual = [...f.s, f.goal], next = f.ns || f.s;
    const names = [tr('m0075'), tr('m0076'), tr('m0077'), tr('m0078'), tr('m0079')];
    $('observationRows').innerHTML = names.map((n, i) => `<tr><td>${n}</td><td>${F(actual[i], 3)}</td><td>${F(sensed[i], 3)}</td><td><b>o${i + 1} = ${F(o[i], 3)}</b></td></tr>`).join('');
    const decision = S.lastFrame && S.mode === 'live' ? tr('tip.decisionAt', f.controlIndex, F(f.decisionTime, 2)) : tr('tip.preview');
    $('lessonTag').textContent = decision;
    $('decisionChain').innerHTML = [
        flowBox(tr('tip.sense'), `θ ${F(sensed[2] * 180 / Math.PI, 2)}° · ω ${F(sensed[3], 2)}`, tr('tip.senseSub')),
        flowBox(tr('tip.choose'), `P(→) ${F(f.p[1] * 100, 1)}%`, tr('tip.reference', F(f.command, 1))),
        flowBox(tr('tip.drive'), `${F(f.drive?.contactForce ?? f.motorForce ?? 0, 2)} N`, tr('tip.driveSub'))
    ].join('<span class="flow-arrow" aria-hidden="true">→</span>');
    $('decisionResult').textContent = tr('tip.responseValue', F(next[2] * 180 / Math.PI, 2), F(next[0] - f.goal, 3), F(f.reward, 3));
    $('forcePath').innerHTML = [
        flowBox(tr('tip.tipForce'), F(f.tipForce || 0, 2) + ' N'),
        flowBox(tr('tip.moment'), F(f.tipMoment || 0, 3) + ' N·m'),
        flowBox(tr('tip.bodyForce'), F(f.externalForce || 0, 2) + ' N'),
        flowBox(tr('tip.impulse'), F(HOLD.impulse, 3) + ' N·s')
    ].join('');
}
function initInteraction() {
    for (const [id, direction] of [['pushLeft', -1], ['pushRight', 1]]) {
        const button = $(id);
        button.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            if (beginHold('pointer:' + e.pointerId, direction)) button.setPointerCapture(e.pointerId);
        });
        for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
            button.addEventListener(event, e => releaseHold('pointer:' + e.pointerId));
        // Accessible hold with Space/Enter while the push button is focused.
        button.addEventListener('keydown', e => {
            if (!['Space', 'Enter'].includes(e.code)) return;
            e.preventDefault(); if (!e.repeat) beginHold('button:' + e.code, direction);
        });
        button.addEventListener('keyup', e => {
            if (['Space', 'Enter'].includes(e.code)) { e.preventDefault(); releaseHold('button:' + e.code); }
        });
    }
    window.addEventListener('pointerup', e => releaseHold('pointer:' + e.pointerId));
    window.addEventListener('pointercancel', e => releaseHold('pointer:' + e.pointerId));
    window.addEventListener('keyup', e => { releaseHold(e.key); releaseHold('button:' + e.code); });
    window.addEventListener('blur', () => releaseHold());
    for (const id of ['conditions', 'notes']) $(id).addEventListener('toggle', () => { if ($(id).open) releaseHold(); });
    $('conditionsBtn').addEventListener('click', () => releaseHold());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') releaseHold(); });
    // The redundant onboarding row is retained as a small optional help panel.
    $('quickstart').hidden = true;
    updateControlStatus();
}

