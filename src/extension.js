// Conditions are an explicit draft. Only the three commit buttons below mutate
// a simulator or the worker. Reading/changing a form never mutates live state.
let PROFILE_LABELS = { nominal: tr("m0232"), push: tr("m0233"), wind: tr("m0234"), sensor: tr("m0235"), actuator: tr("m0236"), model: tr("m0237"), mixed: tr("m0238"), ood: tr("m0239"), randomized: tr("m0238") };
let PLAN_LABELS = { fixed: tr("m0240"), ramp: tr("m0241"), staged: tr("m0242") };
let SPEC_FIELDS = [
    ['mc', tr("m0243"), 'kg', .1, 10, .1, tr("m0244")],
    ['mp', tr("m0245"), 'kg', .02, 2, .01, tr("m0246")], ['l', tr("m0247"), 'm', .1, 1.5, .05, tr("m0248")],
    ['gravity', tr("m0249"), 'm/s²', 1, 20, .1, tr("m0250")], ['force', tr("m0251"), 'N', 1, 60, 1, tr("m0252")],
    ['ratio', tr("m0253"), tr("m0254"), 1, 8, .1, tr("m0255")], ['mu', tr("m0256"), '—', .1, 3, .1, tr("m0257")],
    ['modelSpread', tr("m0258"), tr("m0259"), 0, .5, .05, tr("m0260")], ['friction', tr("m0261"), 'N·s/m', 0, 2, .05, tr("m0262")],
    ['push', tr("m0263"), 'N', 0, 40, 1, tr("m0264")], ['pushMin', tr("m0265"), 's', .02, 2, .02, tr("m0266")], ['pushMax', tr("m0267"), 's', .02, 2, .02, tr("m0268")], ['pushPeriod', tr("m0269"), 's', .1, 10, .1, tr("m0270")],
    ['wind', tr("m0271"), 'N', 0, 15, .5, tr("m0272")], ['noise', tr("m0273"), tr("m0254"), 0, 10, .25, tr("m0274")],
    ['delay', tr("m0275"), 's', 0, .1, .02, tr("m0276")], ['lag', tr("m0277"), 's', 0, .1, .005, tr("m0278")], ['gainSpread', tr("m0279"), tr("m0259"), 0, .5, .05, tr("m0280")]
];
function planText(plan) { return PLAN_LABELS[plan] || plan; }
function motorText(s) { return s ? (s.actuator==='ideal'?tr('ideal.label'):(P.ACTUATORS[s.actuator]?.label || s.actuator)) : tr("m0035"); }
function equalSpec(a, b) { return !!a && !!b && Object.keys(P.DEFAULT_SPEC).every(k => a[k] === b[k]); }
function safeCurrentProfile() { return ['nominal', 'push', 'wind', 'sensor', 'actuator', 'model', 'mixed'].includes(S.env?.profile) ? S.env.profile : 'nominal'; }
function formHTML() {
    return tr("m0281", Object.entries(P.ACTUATORS).map(([k, a]) => `<option value="${k}">${a.vin===0?tr('ideal.label'):a.label}</option>`).join(''), Object.entries(PROFILE_LABELS).filter(([k]) => !['ood', 'randomized'].includes(k)).map(([k, t]) => `<option value="${k}">${t}</option>`).join(''), Object.entries(PLAN_LABELS).map(([k, t]) => `<option value="${k}">${t}</option>`).join(''), SPEC_FIELDS.map(([k, t, u, min, max, step, note]) => `<label class="spec-item"><span>${t}<small>${u}</small></span><input id="spec_${k}" type="number" min="${min}" max="${max}" step="${step}" value="${S.conditionDraft[k]}"><em>${note}</em></label>`).join(''));
}
function writeConditionForm() { if (!$('specActuator'))
    return; $('specActuator').value = S.conditionDraft.actuator; $('specProfile').value = S.conditionProfile; $('specPlan').value = S.conditionPlan; for (const [k] of SPEC_FIELDS)
    $('spec_' + k).value = S.conditionDraft[k]; renderDraftFacts(); }
function readConditionForm() { const raw = { actuator: $('specActuator').value }; for (const [k] of SPEC_FIELDS)
    raw[k] = +$('spec_' + k).value; const spec = P.validateSpec(raw); S.conditionDraft = spec; S.conditionProfile = $('specProfile').value; S.conditionPlan = $('specPlan').value; return spec; }
function renderDraftFacts() {
    const key = $('specActuator').value, a = P.ACTUATORS[key];
    $('motorFacts').textContent = key === 'ideal' ? tr("m0282") : tr("m0283", F(a.kt, 4), F(a.R, 4), F(a.armature, 6), a.vin);
    const profile = $('specProfile').value, plan = $('specPlan').value;
    $('conditionNotice').textContent = plan === 'staged' ? tr("m0284") : plan === 'ramp' ? tr("m0285") : tr("m0286", PROFILE_LABELS[profile]);
    markActiveFields();
    const busy = S.running || S.busy;
    $('continuePlant').disabled = !S.ready || busy;
    $('newPlant').disabled = busy;
}
function openConditions() {
    if ($('conditions').open)
        return;
    $('conditionsBody').innerHTML = formHTML();
    writeConditionForm();
    $('conditions').showModal();
    $('specActuator').onchange = renderDraftFacts;
    $('specProfile').onchange = renderDraftFacts;
    $('specPlan').onchange = renderDraftFacts;
    $('loadTrainDraft').onclick = () => { if (!S.activeHp)
        return; S.conditionDraft = copy(S.activeHp.plant); S.conditionProfile = S.activeHp.profile === 'randomized' ? 'mixed' : S.activeHp.profile; S.conditionPlan = S.activeHp.plan; writeConditionForm(); };
    $('loadPolicyDraft').onclick = () => { const p = S.applied?.policy; if (!p?.plant)
        return; S.conditionDraft = copy(p.plant); S.conditionProfile = p.trainedProfile || 'nominal'; S.conditionPlan = 'fixed'; writeConditionForm(); };
    $('testOnly').onclick = () => { try {
        const spec = readConditionForm();
        applyTestConditions(spec, S.conditionProfile);
        $('conditions').close();
        toast(tr("m0287"));
    }
    catch (e) {
        toast(e.message);
    } };
    $('continuePlant').onclick = () => { try {
        if (S.busy || S.running)
            throw Error(tr("m0288"));
        const spec = readConditionForm();
        S.worker.postMessage({ type: 'continue', plant: spec, profile: S.conditionProfile, plan: S.conditionPlan });
        $('conditions').close();
        setChapter(5);
    }
    catch (e) {
        toast(e.message);
    } };
    $('newPlant').onclick = () => { try {
        if (S.busy || S.running)
            throw Error(tr("m0288"));
        const spec = readConditionForm();
        if ((S.latest?.iter || 0) > 0 && !confirm(tr("m0289")))
            return;
        S.draft.plant = copy(spec);
        S.draft.profile = S.conditionProfile;
        S.draft.plan = S.conditionPlan;
        S.source = 'own';
        S.selected = 0;
        S.followRecord = true;
        S.calcCache = null;
        initializeWorker(true);
        $('conditions').close();
        setChapter(5);
        toast(tr("m0290"));
    }
    catch (e) {
        toast(e.message);
    } };
}
function applyTestConditions(spec, profile) { const candidate = new CartPole(new RNG(20260915), { spec: P.validateSpec(spec), profile, level: 1, seed: 950001 }); candidate.goal = +$('target').value; S.env = candidate; S.lastFrame = null; S.liveTrace = []; S.pulseSteps = 0; S.mode = 'live'; S.replayPlaying = false; S.lastTs = null; syncTimeCap(); S.calcPlaying = false; render(); updateHardwareReadout(); }
function curriculumMarkup() {
    const c = S.currentCurriculum, plan = S.activeHp?.plan || S.draft.plan;
    if (plan !== 'staged')
        return tr("m0291", planText(plan), plan === 'ramp' ? tr("m0292") : tr("m0293"));
    const ix = c?.index || 0, labels = [tr("m0294"), tr("m0295"), tr("m0296"), tr("m0297"), tr("m0298"), tr("m0299")];
    return tr("m0300", labels[ix], labels.map((t, i) => `<span class="${i === ix ? 'current' : i < ix ? 'complete' : ''}">${i + 1} ${t}</span>`).join(''), c?.last ? tr("m0301", c.last.iter, c.last.passed, c.last.count, c.streak) : tr("m0302"), S.sessionBoundary !== undefined ? tr("m0303", S.sessionBoundary) : '');
}
function updateHardwareReadout() {
    if (!S.env)
        return;
    const p = S.applied?.policy, t = S.activeHp?.plant, s = S.env.spec, trainProfile = S.activeHp?.plan === 'staged' ? P.STAGES[S.currentCurriculum?.index || 0] : S.activeHp?.profile, policyProfile = p?.trainedProfile || 'nominal';
    const same = equalSpec(s, p?.plant) && S.env.profile === policyProfile;
    const identity = `${S.latest?.iter}|${S.appliedSource}|${S.applied?.iter}|${JSON.stringify(s)}|${JSON.stringify(t)}|${trainProfile}|${S.env.profile}|${S.mode}|${isSample()}`;
    if (updateHardwareReadout.identity !== identity) {
        updateHardwareReadout.identity = identity;
        $('conditionbar').innerHTML = tr("m0304", t?.actuator?.toUpperCase() || tr("m0199"), PROFILE_LABELS[trainProfile] || trainProfile || tr("m0294"), sourceName(S.appliedSource), S.applied?.iter || 0, p?.plant?.actuator?.toUpperCase() || '—', PROFILE_LABELS[policyProfile], s.actuator.toUpperCase(), PROFILE_LABELS[S.env.profile] || S.env.profile, same ? 'match-state' : 'mismatch-state', isSample() ? tr("m0305") : S.mode === 'replay' ? tr("m0306") : same ? tr("m0307") : tr("m0308"));
        $('matchPolicyWorld').onclick = () => { if (p?.plant)
            applyTestConditions(p.plant, policyProfile); };
    }
    if ($('curriculumPanel')) {
        const markup = curriculumMarkup();
        if ($('curriculumPanel').innerHTML !== markup)
            $('curriculumPanel').innerHTML = markup;
    }
    const el = $('driveReadout'), canvas = $('wheelDetail');
    if (!canvas || !canvas.closest('details').open)
        return;
    const v = scene(), d = v?.drive || (!isSample() && S.mode === 'live' ? S.env.lastOut?.drive : null), sp = v?.plant || s;
    el.innerHTML = tr("m0309", isSample() ? tr("m0310") : S.mode === 'replay' ? tr("m0311") : tr("m0312"), sp.actuator.toUpperCase(), [[tr("m0313"), d?.voltage, 'V'], [tr("m0314"), d?.current, 'A'], [tr("m0315"), d?.motorTorque, 'N·m'], [tr("m0316"), d?.frictionBudget, 'N·m'], [tr("m0317"), d?.contactForce, 'N'], [tr("m0318"), d?.reflectedMass, 'kg'], [tr("m0319"), d?.rotorSpeed, 'rad/s'], [tr("m0320"), (d?.tractionRatio ?? NaN) * 100, '%'],[tr('drive.normal'),d?.normalForce,'N'],[tr('drive.traction.limit'),d?.tractionLimit,'N']].map(([n, x, u]) => `<div><small>${n}</small><b>${F(x, 3)} <em>${u}</em></b></div>`).join(''), d ? (d.saturated ? tr("m0321") : tr("m0322")) : '—');
    const box = ctx(canvas);
    if (box) {
        const { g, w, h } = box;
        renderWheelMesh(g, w * .5, h * .49, Math.min(w * .4, h * .38), (v?.s?.[0] || 0) / P.WHEEL.radius);
        text(g, tr("m0323"), w / 2, h - 8, C.muted, 11, 'center');
    }
}
function initHardware() { $('conditionsBtn').onclick = openConditions; $('closeConditions').onclick = () => $('conditions').close(); document.querySelector('.drive-details').addEventListener('toggle', updateHardwareReadout); updateHardwareReadout(); }
