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
function syncFollowGuide() { if (S.followGuide && $('followExperience')?.open) renderFollowGuide(); }
function collapseFollowGuide() { if ($('followExperience')) $('followExperience').open = false; S.followGuide = null; }
function followStageContent(guide, stage) {
    const c = guide.c, g = guide.g, q = c.q, action = q.action ? tr('m0128') : tr('m0129');
    if (stage === 'input') {
        const labels = [tr('m0111'), tr('m0112'), tr('m0113'), tr('m0114'), tr('m0115')];
        return `<div class="flow-box" data-follow-stage="input"><small>${tr('follow.input')}</small>
      <div class="term-table">${q.obs.map((v, i) => `<div class="term"><small>${labels[i]}</small><b>o${i + 1} = ${F(v, 5)}</b></div>`).join('')}</div>
      <p class="inline-note">${tr('follow.inputSub', action, F(q.r, 4))}</p></div>`;
    }
    if (stage === 'calculation') {
        return `<div class="flow-box" data-follow-stage="calculation"><small>${tr('follow.calc')}</small>
      <div class="math-line">r=${F(q.r, 4)} + γV(next)=${NUM(g.bootstrap)} − V_old=${F(q.oldV, 4)} = δ=${NUM(g.delta)}</div>
      <div class="math-line">A_raw=${NUM(g.raw)} → A=${NUM(g.normalized)}</div>
      <p class="inline-note">${tr('follow.calcSub')}</p></div>`;
    }
    if (stage === 'action') {
        const collectionP = Math.exp(q.oldLogp), beforeP = c.pa[q.action];
        return `<div class="flow-box" data-follow-stage="action"><small>${tr('follow.action')}</small>
      <p>${tr('follow.actionChosen', action)}</p>
      ${probRow(tr('m0156'), collectionP, C.muted)}${probRow(tr('m0157'), beforeP, C.blue)}
      <div class="math-line">ρ = ${F(beforeP, 4)} / ${F(collectionP, 4)} = ${F(c.loss.ratio, 4)}</div>
      <div class="mono">${c.loss.active ? tr('m0160') : tr('m0161')} · L = ${NUM(c.loss.loss)}</div>
      <p class="inline-note">${tr('follow.actionSub')}</p></div>`;
    }
    return `<div class="flow-box" data-follow-stage="result"><small>${tr('follow.result')}</small>
    ${probRow(tr('m0157'), c.pa[q.action], C.blue)}${probRow(tr('m0158'), c.afterP[q.action], C.green)}
    <p class="inline-note">${tr('follow.resultBadge')}</p>
    <p class="warning">${tr('follow.minibatchWarning', c.d.batchData.length)}</p></div>`;
}
function renderFollowGuide() {
    const body = $('followExperienceBody');
    if (!body || !S.followGuide) return;
    const guide = S.followGuide;
    if (!followIdentityMatches(guide.id)) {
        body.innerHTML = `<p class="tag neutral">${tr('follow.recordedLabel')}</p><p class="warning">${tr('follow.stale', guide.badge)}</p><button class="primary" id="followRecapture">${tr('follow.recapture')}</button>`;
        $('followRecapture').onclick = recaptureFollowGuide;
        return;
    }
    const nav = `<div class="follow-nav" role="tablist">${FOLLOW_STAGES.map((stage, i) => {
        const label = [tr('follow.input'), tr('follow.calc'), tr('follow.action'), tr('follow.result')][i];
        return `<button role="tab" aria-selected="${S.followStage === i}" aria-current="${S.followStage === i ? 'step' : 'false'}" data-follow-stage-nav="${i}" class="${S.followStage === i ? 'active' : ''}">${label}</button>`;
    }).join('')}</div>`;
    const key = `${guide.id.source}:${guide.id.iter}:${guide.id.sample}:${guide.id.generation}`;
    body.innerHTML = `<div class="follow-panel" data-follow-key="${key}" data-follow-current-stage="${FOLLOW_STAGES[S.followStage]}">
    <p class="tag neutral">${tr('follow.recordedLabel')}</p>
    <p class="causal-lead">${tr('follow.lead', guide.badge)}</p>
    ${nav}
    ${followStageContent(guide, FOLLOW_STAGES[S.followStage])}
  </div>`;
    body.querySelectorAll('[data-follow-stage-nav]').forEach(b => b.onclick = () => { S.followStage = +b.dataset.followStageNav; renderFollowGuide(); });
}
function initFollowExperience() {
    if (!$('followExperience')) return;
    $('followExperience').addEventListener('toggle', () => { if ($('followExperience').open) openFollowGuide(); else S.followGuide = null; });
    const _updateHardwareReadout = updateHardwareReadout, _setChapter = setChapter, _setInterfaceLanguage = setInterfaceLanguage;
    updateHardwareReadout = (...a) => { _updateHardwareReadout(...a); syncFollowGuide(); };
    setChapter = (...a) => { _setChapter(...a); collapseFollowGuide(); };
    setInterfaceLanguage = (...a) => { _setInterfaceLanguage(...a); syncFollowGuide(); };
}
