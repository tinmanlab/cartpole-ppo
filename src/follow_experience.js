// Opt-in, read-only walkthrough of one recorded experience. Captures the
// already-computed Lesson.inspect()/Lesson.gae() objects ONCE at open time and
// reuses that frozen reference for every stage/re-render, so navigating stages
// or switching language never re-derives numbers from a possibly-changed
// current selection. Never advances physics, never touches the live/learner
// policy or optimizer, and pauses the live plant so it can't be confused with
// this recorded lesson.
const FOLLOW_STAGES = ['input', 'calculation', 'action', 'result'];
function followIdentity() { return { source: S.source, iter: S.selected, sample: S.sample, generation: S.source === 'own' ? S.generation : null }; }
function followIdentityMatches(id) { const cur = followIdentity(); return cur.source === id.source && cur.iter === id.iter && cur.sample === id.sample && cur.generation === id.generation; }
function followBadge(id) { return `${sourceName(id.source)} I.${id.iter} · ${tr('follow.sampleBadge', id.sample + 1)}`; }
function pauseLiveForGuide() { releaseHold(); S.paused = true; S.lastTs = null; updateChrome(); }
function openFollowGuide() {
    const c = calculation();
    if (!c) { $('followExperience').open = false; toast(tr('follow.unavailable')); return; }
    pauseLiveForGuide();
    const id = followIdentity();
    S.followGuide = { id, badge: followBadge(id), c, g: Lesson.gae(c.q, c.record.hp) };
    S.followStage = 0;
    renderFollowGuide();
}
function recaptureFollowGuide() { openFollowGuide(); }
function followSignature(guide) {
    return followIdentityMatches(guide.id)
        ? `valid:${guide.id.source}:${guide.id.iter}:${guide.id.sample}:${guide.id.generation}:${S.followStage}:${I18n.language}`
        : `stale:${guide.badge}:${I18n.language}`;
}
function syncFollowGuide() { if (S.followGuide && $('followExperience')?.open) renderFollowGuide(); }
function collapseFollowGuide() { if ($('followExperience')) $('followExperience').open = false; S.followGuide = null; }
function followChapterLink(n) { return `<button class="text-btn small" data-follow-chapter="${n}">${tr('follow.jumpChapter', n, CHAPTERS[n][1])}</button>`; }
function followStageContent(guide, stage) {
    const c = guide.c, g = guide.g, q = c.q, action = q.action ? tr('m0128') : tr('m0129'), i = FOLLOW_STAGES.indexOf(stage);
    const stageLabelKey = { input: 'follow.input', calculation: 'follow.calc', action: 'follow.action', result: 'follow.result' }[stage];
    const shell = (inner) => `<div class="flow-box" data-follow-stage="${stage}" id="followPanel-${stage}" role="tabpanel" aria-labelledby="followTab-${i}" tabindex="0"><small>${tr(stageLabelKey)}</small>${inner}</div>`;
    if (stage === 'input') {
        const labels = [tr('m0111'), tr('m0112'), tr('m0113'), tr('m0114'), tr('m0115')];
        return shell(`
      <p class="tag neutral">${tr('follow.inputNormalized')}</p>
      <div class="follow-input-grid">${q.obs.map((v, i) => `<div class="term"><small>${labels[i]}</small><b>o${i + 1} = ${F(v, 5)}</b></div>`).join('')}</div>
      <p class="inline-note">${tr('follow.inputSub', action, F(q.r, 4))}</p>
      ${followChapterLink(1)}`);
    }
    if (stage === 'calculation') {
        const rawSign = g.raw > 0 ? 'pos' : g.raw < 0 ? 'neg' : 'zero';
        const normSign = g.normalized > 0 ? 'pos' : g.normalized < 0 ? 'neg' : 'zero';
        const rawKey = { pos: 'follow.calcRawPos', neg: 'follow.calcRawNeg', zero: 'follow.calcRawZero' }[rawSign];
        const normKey = { pos: 'follow.calcNormPos', neg: 'follow.calcNormNeg', zero: 'follow.calcNormZero' }[normSign];
        return shell(`
      <div class="follow-calc-grid">
        <div class="term"><small>${tr('follow.calcReward')}</small><b>r=${F(q.r, 4)}</b></div>
        <div class="term"><small>${tr('follow.calcBootstrap')}</small><b>γV(next)=${NUM(g.bootstrap)}</b></div>
        <div class="term"><small>${tr('follow.calcOldV')}</small><b>V_old=${F(q.oldV, 4)}</b></div>
        <div class="term output"><small>${tr('follow.calcDelta')}</small><b>δ=${NUM(g.delta)}</b></div>
      </div>
      <div class="follow-calc-grid pair">
        <div class="term"><small>${tr('follow.calcRaw')}</small><b>A_raw=${NUM(g.raw)}</b></div>
        <div class="term output"><small>${tr('follow.calcNorm')}</small><b>A=${NUM(g.normalized)}</b></div>
      </div>
      <p class="inline-note" data-follow-sign="raw" data-follow-sign-value="${rawSign}">${rawSign === 'zero' ? tr(rawKey) : tr(rawKey, NUM(Math.abs(g.raw)))}</p>
      <p class="inline-note" data-follow-sign="normalized" data-follow-sign-value="${normSign}">${normSign === 'zero' ? tr(normKey) : tr(normKey, NUM(Math.abs(g.normalized)))}</p>
      <p class="inline-note">${tr('follow.calcSub')}</p>
      <p class="inline-note">${tr('follow.calcSignCaveat')}</p>`);
    }
    if (stage === 'action') {
        const collectionP = Math.exp(q.oldLogp), beforeP = c.pa[q.action];
        return shell(`
      <p class="tag neutral">${tr('follow.actionRecordedHeading')}</p>
      <p>${tr('follow.actionChosen', action)}</p>
      <p class="tag neutral">${tr('follow.actionEvalHeading')}</p>
      ${probRow(tr('m0156'), collectionP, C.muted)}${probRow(tr('m0157'), beforeP, C.blue)}
      <div class="math-line">ρ = ${F(beforeP, 4)} / ${F(collectionP, 4)} = ${F(c.loss.ratio, 4)}</div>
      <div class="mono">${c.loss.active ? tr('m0160') : tr('m0161')} · L = ${NUM(c.loss.loss)}</div>
      <p class="inline-note">${tr('follow.actionSub')}</p>
      ${followChapterLink(4)}`);
    }
    const dp = c.afterP[q.action] - c.pa[q.action], w = Lesson.weight(c, 'actor', 0);
    return shell(`
    ${probRow(tr('m0157'), c.pa[q.action], C.blue)}${probRow(tr('m0158'), c.afterP[q.action], C.green)}
    <p class="mono" data-follow-delta>${tr('follow.resultDeltaLabel')} ${dp >= 0 ? '+' : ''}${F(dp * 100, 3)} pp</p>
    <p class="inline-note">${tr('follow.resultDeltaNote')}</p>
    <p class="inline-note">${tr('follow.resultBadge')}</p>
    <p class="warning">${tr('follow.minibatchWarning', c.d.batchData.length)}</p>
    <p class="mono" data-follow-weight data-follow-weight-kind="actor" data-follow-weight-index="0">${w.label}: ${NUM(w.before)} → ${NUM(w.after)} (Δ${NUM(w.delta)})</p>
    <p class="inline-note">${tr('follow.weightWitnessNote')}</p>
    ${followChapterLink(4)}`);
}
function renderFollowGuide() {
    const body = $('followExperienceBody');
    if (!body || !S.followGuide) return;
    const guide = S.followGuide;
    const sig = followSignature(guide);
    if (guide.renderedSignature === sig && body.firstElementChild) return;
    const focusOnNav = document.activeElement?.dataset?.followStageNav !== undefined;
    guide.renderedSignature = sig;
    if (!followIdentityMatches(guide.id)) {
        body.innerHTML = `<p class="tag neutral">${tr('follow.recordedLabel')}</p><p class="warning">${tr('follow.stale', guide.badge)}</p><button class="primary" id="followRecapture">${tr('follow.recapture')}</button>`;
        $('followRecapture').onclick = recaptureFollowGuide;
        return;
    }
    const nav = `<div class="follow-nav" role="tablist">${FOLLOW_STAGES.map((stage, i) => {
        const label = [tr('follow.input'), tr('follow.calc'), tr('follow.action'), tr('follow.result')][i];
        const active = S.followStage === i;
        return `<button role="tab" id="followTab-${i}" aria-controls="followPanel-${stage}" aria-selected="${active}" aria-current="${active ? 'step' : 'false'}" tabindex="${active ? 0 : -1}" data-follow-stage-nav="${i}" class="${active ? 'active' : ''}">${label}</button>`;
    }).join('')}</div>`;
    const key = `${guide.id.source}:${guide.id.iter}:${guide.id.sample}:${guide.id.generation}`;
    body.innerHTML = `<div class="follow-panel" data-follow-key="${key}" data-follow-current-stage="${FOLLOW_STAGES[S.followStage]}">
    <p class="tag neutral">${tr('follow.recordedLabel')}</p>
    <p class="causal-lead">${tr('follow.lead', guide.badge)}</p>
    ${nav}
    ${followStageContent(guide, FOLLOW_STAGES[S.followStage])}
    <details class="follow-suite"><summary>${tr('follow.suiteLabel')}</summary><p class="inline-note">${tr('follow.suitePurpose')}</p></details>
  </div>`;
    const gotoStage = i => { S.followStage = i; renderFollowGuide(); };
    body.querySelectorAll('[data-follow-stage-nav]').forEach(b => b.onclick = () => gotoStage(+b.dataset.followStageNav));
    body.querySelectorAll('[data-follow-chapter]').forEach(b => b.onclick = () => setChapter(+b.dataset.followChapter));
    const navEl = body.querySelector('.follow-nav');
    if (navEl) navEl.onkeydown = e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const n = FOLLOW_STAGES.length;
        gotoStage(e.key === 'ArrowRight' ? (S.followStage + 1) % n : e.key === 'ArrowLeft' ? (S.followStage - 1 + n) % n : e.key === 'Home' ? 0 : n - 1);
    };
    if (focusOnNav) $(`followTab-${S.followStage}`)?.focus();
}
function initFollowExperience() {
    if (!$('followExperience')) return;
    $('followExperience').addEventListener('toggle', () => { if ($('followExperience').open) openFollowGuide(); else S.followGuide = null; });
    const _updateHardwareReadout = updateHardwareReadout, _setChapter = setChapter, _setInterfaceLanguage = setInterfaceLanguage;
    updateHardwareReadout = (...a) => { _updateHardwareReadout(...a); syncFollowGuide(); };
    setChapter = (...a) => { _setChapter(...a); collapseFollowGuide(); };
    setInterfaceLanguage = (...a) => { _setInterfaceLanguage(...a); syncFollowGuide(); };
}
