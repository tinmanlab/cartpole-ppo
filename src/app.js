'use strict';
const $ = id => document.getElementById(id), F = (x, n = 3) => Number.isFinite(x) ? x.toFixed(n) : '—', NUM = x => Number.isFinite(x) ? (Math.abs(x) > 0 && Math.abs(x) < .0001 ? x.toExponential(3) : x.toFixed(6)) : '—', copy = x => x === undefined ? null : JSON.parse(JSON.stringify(x));
const C = { ink: '#192c43', muted: '#677c92', blue: '#327de0', green: '#139964', amber: '#c57b20', purple: '#7c60be', red: '#c94949', grid: '#e7edf4' };
const EX = JSON.parse($('exampleData').textContent), ROB = JSON.parse($('robustData').textContent);
const DATA = { example: new Map(EX.records.map(r => [r.iter, r])), robust: new Map(ROB.records.map(r => [r.iter, r])), own: new Map() };
const EXAMPLE_FINAL = Math.max(...DATA.example.keys());
const S = { chapter: 1, source: 'example', selected: EXAMPLE_FINAL, sample: 0, kind: 'actor', neuron: 0, input: 2, weight: 2, forward: 0, update: 0, calcPlaying: false, calcElapsed: 0, calcCache: null, followRecord: false, netMode: 'activation', netLive: false, conditionDraft: { ...P.DEFAULT_SPEC }, conditionProfile: 'nominal', conditionPlan: 'fixed',
    ready: false, busy: false, running: false, finishRequested: false, until: 0, worker: null, generation: 0, timer: null, phase: 'idle', phaseData: {}, latest: null, history: [], activeHp: null, applyOnReady: false,
    actor: null, critic: null, applied: null, appliedSource: 'example', followPolicy: false, env: null, lastFrame: null, paused: false, pulse: 0, pulseSteps: 0, resets: 0, physicsCount: 0, manualSteps: 0, clock: new RTClock(), hidden: document.hidden, lastTs: null, lastUI: 0, lastChart: 0, liveTrace: [], rng: new RNG(5049),
    mode: 'live', replay: null, replayAt: 0, replayPlaying: false, replayAcc: 0, replayActor: null, replayCritic: null,
    evalWorker: null, evalRequest: 0, evalBusy: false, evalRows: null, evalMeta: null, evalProgress: 0,
    draft: { seed: 123, lr: .0007, criticLR: .002, gamma: .99, lambda: .95, epsilon: .2, entropy: .005, profile: 'nominal', curriculum: true, plant: { ...P.DEFAULT_SPEC }, plan: 'fixed' }, learningLength: 120, pace: 80, syncEvery: 2
};
let CHAPTERS = [null, ['ENVIRONMENT', tr("m0001"), tr("m0002"), tr("m0003")], ['ACTOR / CRITIC', tr("m0004"), tr("m0005"), tr("m0006")], ['LEARNING SIGNAL', tr("m0007"), tr("m0008"), tr("m0009")], ['PPO UPDATE', tr("m0010"), tr("m0011"), tr("m0012")], ['INFERENCE / TEST', tr("m0013"), tr("m0014"), tr("m0015")]];
let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function error(text) { $('fatal').textContent = text; $('fatal').hidden = false; S.running = false; clearTimeout(S.timer); }
function selected() { return DATA[S.source].get(S.selected) || null; }
function sourceName(src = S.source) { return src === 'example' ? tr("m0016") : src === 'robust' ? tr("m0017") : tr("m0018"); }
function isSample() { return S.chapter >= 2 && S.chapter <= 4 && !(S.chapter === 2 && S.netLive); }
function calculation() {
    const r = selected();
    if (!r?.detail)
        return null;
    const key = `${S.source}:${r.iter}:${S.sample}`;
    if (S.calcCache?.key === key)
        return S.calcCache;
    const c = Lesson.inspect(r, S.sample);
    if (!c)
        return null;
    c.key = key;
    c.collectionModels = { actor: MLP.from(r.before.actor), critic: MLP.from(r.before.critic) };
    c.collectionPass = { actor: c.collectionModels.actor.forward(c.q.obs), critic: c.collectionModels.critic.forward(c.q.obs) };
    c.collectionP = probabilities(c.collectionPass.actor.y);
    S.calcCache = c;
    return c;
}
function selectSample(i) { const count = selected()?.detail?.batchData.length || 0; S.sample = Math.max(0, Math.min(count - 1, i)); S.calcCache = null; S.calcPlaying = false; S.calcElapsed = 0; render(); }
function pickSign(sign) { const qs = selected()?.detail?.batchData || []; const candidates = qs.map((q, i) => ({ q, i })).filter(x => sign * x.q.adv > 0); if (!candidates.length) {
    toast(tr("m0019"));
    return;
} candidates.sort((a, b) => Math.abs(b.q.adv) - Math.abs(a.q.adv)); selectSample(candidates[0].i); }
function fillRecords() { const keys = [...DATA[S.source].keys()].sort((a, b) => a - b), el = $('recordSelect'); el.replaceChildren(...keys.map(k => new Option(`I.${k}${k === 0 ? tr("m0020") : ''}`, k))); if (!DATA[S.source].has(S.selected))
    S.selected = keys.at(-1) ?? 0; el.value = S.selected; $('recordSource').value = S.source; }
function chooseRecord(iter) { if (!DATA[S.source].has(iter))
    return; S.selected = iter; S.sample = 0; S.calcCache = null; S.calcPlaying = false; S.followRecord = false; const d = selected()?.detail; if (d) {
    const ix = d.batchData.findIndex(q => q.adv > .4);
    S.sample = ix < 0 ? 0 : ix;
} fillRecords(); render(); }
function chooseSource(src) { S.source = src; S.followRecord = false; S.selected = DATA[src].has(120) ? 120 : [...DATA[src].keys()].at(-1) ?? 0; chooseRecord(S.selected); fillRecords(); render(); }
function setChapter(n) { releaseHold(); n = clip(n, 1, 5); S.chapter = n; S.calcPlaying = false; S.lastTs = null; if (isSample())
    S.followRecord = false; render(); }
function apply(record, src, follow = false) { if (!record)
    return; Lesson.validatePolicy(record.policy); S.actor = MLP.from(record.policy.actor); S.critic = MLP.from(record.policy.critic); S.applied = record; S.appliedSource = src; S.followPolicy = follow; S.lastFrame = null; }
function applySelected() { const r = selected(); if (!r)
    return; apply(r, S.source, false); S.mode = 'live'; S.replayPlaying = false; setChapter(5); toast(tr("m0021", sourceName(), r.iter)); }
function initializeWorker(applyOnReady = false) {
    if (S.worker)
        S.worker.terminate();
    clearTimeout(S.timer);
    S.generation++;
    const gen = S.generation;
    S.ready = false;
    S.busy = false;
    S.running = false;
    S.finishRequested = false;
    S.latest = null;
    S.history = [];
    DATA.own.clear();
    S.applyOnReady = applyOnReady;
    S.phase = 'idle';
    $('fatal').hidden = true;
    try {
        const url = URL.createObjectURL(new Blob([$('engine').textContent, '\n', $('lessonEngine').textContent, '\n', $('workerSource').textContent], { type: 'text/javascript' }));
        S.worker = new Worker(url);
        URL.revokeObjectURL(url);
        S.worker.onmessage = ({ data: m }) => {
            if (gen !== S.generation)
                return;
            if (m.type === 'ready' || m.type === 'restored') {
                S.ready = true;
                S.busy = false;
                S.running = false;
                if (m.type === 'restored') {
                    DATA.own.clear();
                    S.history = [];
                    S.source = 'own';
                    S.followRecord = true;
                    S.applyOnReady = true;
                    S.draft = { seed: m.seed, ...m.record.hp };
                }
                store(m.record);
                if (S.applyOnReady) {
                    apply(m.record, 'own', false);
                    S.applyOnReady = false;
                }
                if (S.chapter === 5)
                    render();
                else
                    updateChrome();
            }
            else if (m.type === 'phase') {
                S.phase = m.phase;
                S.phaseData = m;
                updateTraining();
                updateChrome();
            }
            else if (m.type === 'result') {
                S.busy = false;
                S.phase = 'idle';
                store(m.record);
                const end = S.running && m.record.iter >= S.until;
                if (S.finishRequested || end) {
                    S.finishRequested = false;
                    S.running = false;
                    apply(m.record, 'own', false);
                    toast(tr("m0022", m.record.iter));
                }
                else if (S.followPolicy && m.record.iter % S.syncEvery === 0)
                    apply(m.record, 'own', true);
                updateChrome();
                updateTraining();
                drawTrainingChart();
                schedule();
            }
            else if (m.type === 'continued') {
                S.activeHp = copy(m.hp);
                S.currentCurriculum = copy(m.curriculum);
                S.draft = { seed: S.draft.seed, ...copy(m.hp) };
                S.sessionBoundary = S.latest?.iter || 0;
                S.history = [];
                toast(tr("m0023"));
                render();
            }
            else if (m.type === 'checkpoint') {
                saveJSON(m.data, `ppo-step-checkpoint-I${m.data.iter}.json`);
            }
            else if (m.type === 'notice') {
                toast(tr("m0024") + m.message);
            }
            else if (m.type === 'error') {
                S.busy = false;
                S.ready = false;
                error(tr("m0025") + m.message);
                updateChrome();
                updateTraining();
            }
        };
        S.worker.onerror = e => { if (gen === S.generation) {
            S.ready = false;
            S.busy = false;
            error(tr("m0026") + e.message);
            updateTraining();
        } };
        S.worker.postMessage({ type: 'init', seed: S.draft.seed, hp: { lr: S.draft.lr, criticLR: S.draft.criticLR, gamma: S.draft.gamma, lambda: S.draft.lambda, epsilon: S.draft.epsilon, entropy: S.draft.entropy, profile: S.draft.profile, curriculum: S.draft.curriculum, plant: S.draft.plant, plan: S.draft.plan } });
    }
    catch (e) {
        error(e.message);
    }
    updateChrome();
}
function store(r) { DATA.own.set(r.iter, r); S.latest = r; S.activeHp = r.hp; S.currentCurriculum = copy(r.curriculum); S.history.push({ iter: r.iter, mean: r.evaluation.mean, passed: r.evaluation.reached, policy: r.stats.piLoss, value: r.stats.valueLoss }); if (S.history.length > 1000)
    S.history.splice(1, 1); while (DATA.own.size > 121) {
    const k = [...DATA.own.keys()].find(x => x !== 0 && !(S.source === 'own' && S.selected === x));
    if (k === undefined)
        break;
    DATA.own.delete(k);
} if (S.source === 'own' && S.followRecord) {
    S.selected = r.iter;
    S.sample = 0;
    S.calcCache = null;
} fillRecords(); }
function iterate() { if (!S.ready || S.busy || S.hidden)
    return; S.busy = true; S.phase = 'collect'; S.phaseData = { samples: 0, total: 2048 }; S.worker.postMessage({ type: 'iterate' }); updateTraining(); updateChrome(); }
function schedule() { clearTimeout(S.timer); if (S.running && !S.busy && !S.hidden)
    S.timer = setTimeout(iterate, S.pace); }
function startTraining() { if (!S.ready)
    return; if (S.running) {
    finishTraining();
    return;
} S.running = true; S.finishRequested = false; S.until = (S.latest?.iter || 0) + S.learningLength; S.source = 'own'; S.followRecord = true; S.selected = S.latest?.iter || 0; S.calcCache = null; S.followPolicy = true; apply(S.latest, 'own', true); S.mode = 'live'; S.paused = false; $('autoReset').checked = true; fillRecords(); render(); if (!S.busy)
    iterate(); }
function finishTraining() { S.running = false; clearTimeout(S.timer); if (S.busy) {
    S.finishRequested = true;
    toast(tr("m0027"));
}
else if (S.latest)
    apply(S.latest, 'own', false); updateTraining(); updateChrome(); }
function oneIteration() { if (!S.ready || S.busy)
    return; S.running = false; S.finishRequested = true; S.source = 'own'; S.followRecord = true; S.selected = S.latest.iter; fillRecords(); render(); iterate(); }
function newExperiment() { if ((S.latest?.iter || 0) > 0 && !confirm(tr("m0028")))
    return; S.source = 'own'; S.selected = 0; S.followRecord = true; S.calcCache = null; initializeWorker(true); render(); }
function syncTimeCap() { if (!S.env)
    return; S.env.enforceTimeLimit = $('timeCap').checked; if (!S.env.enforceTimeLimit && S.env.truncated && !S.env.terminated) {
    S.env.done = false;
    S.env.truncated = false;
} }
function resetWorld() { releaseHold(); S.env.reset(+$('target').value); syncTimeCap(); S.lastFrame = null; S.pulseSteps = 0; S.liveTrace = []; S.resets++; S.lastTs = null; updateChrome(); drawWorld(); }
function setGoal(v) { v = Math.round(clip(v, -1, 1) * 20) / 20; $('target').value = v; S.env.goal = v; $('targetText').textContent = F(v, 2) + ' m'; }
function physics() {
    syncTimeCap();
    if (S.env.done) {
        if (!$('autoReset').checked)
            return false;
        releaseHold();
        S.env.reset(+$('target').value);
        syncTimeCap();
        S.pulseSteps = 0;
        S.resets++;
        S.liveTrace = [];
    }
    const e = S.env, s = e.s.slice(), obs = e.obs(), ac = policy(S.actor, obs, true), val = S.critic.forward(obs).y[0], step = e.steps, external = S.pulseSteps > 0 ? S.pulse : 0, tip = heldForce(), out = e.step(ac.a, external, tip);
    HOLD.policyCalls++;
    if (tip) { HOLD.appliedSeconds += DT; HOLD.impulse += tip * DT; }
    if (S.pulseSteps > 0)
        S.pulseSteps--;
    S.physicsCount++;
    S.lastFrame = { controlIndex: HOLD.policyCalls, decisionTime: step * DT, s, ns: e.s.slice(), obs, goal: e.goal, step, action: ac.a, p: ac.p, value: val, params: e.params, ...out };
    S.liveTrace.push({ t: e.steps * DT, angle: e.s[2] * 180 / Math.PI, x: e.s[0], goal: e.goal, cmd: out.command, motor: out.motorForce, external: out.externalForce, tip: out.tipForce, contact: out.drive.contactForce });
    if (e.done) releaseHold();
    if (S.liveTrace.length > 600)
        S.liveTrace.shift();
    return true;
}
function snapshot() { const e = S.env, obs = e.obs(), ac = policy(S.actor, obs, true); return { s: e.s.slice(), ns: e.s.slice(), obs, goal: e.goal, step: e.steps, action: ac.a, p: ac.p, value: S.critic.forward(obs).y[0], reward: 0, parts: rewardParts(e.s, e.goal, e.spec), params: e.params, command: (ac.a ? 1 : -1) * e.spec.force, motorForce: e.motorForce, externalForce: 0, force: 0, terminated: e.terminated, truncated: e.truncated }; }
function scene() { if (isSample()) {
    const c = calculation();
    if (!c)
        return null;
    const q = c.q;
    return { ...q, step: Math.floor(q.id / 16), p: S.chapter === 4 ? c.pa : c.collectionP, value: S.chapter === 4 ? c.fc.y[0] : q.oldV, reward: q.r, command: (q.action ? 1 : -1) * (q.plant?.force || 10) };
} if (S.mode === 'replay' && S.replay)
    return S.replay.trace[S.replayAt] || null; return { ...(S.lastFrame || snapshot()), plant: S.env.spec };  }
function startReplay(trace, policySnap, name) { releaseHold(); if (!trace?.length) {
    toast(tr("m0030"));
    return;
} S.replay = { trace, name }; S.replayAt = 0; S.replayAcc = 0; S.replayPlaying = false; S.replayActor = MLP.from(policySnap.actor); S.replayCritic = MLP.from(policySnap.critic); S.mode = 'replay'; S.lastTs = null; render(); }
function replaySelected() { const r = selected(), src=S.source; if (r)
    startReplay(r.evaluation.trace, r.policy, ()=>tr("m0031", sourceName(src), r.iter)); }
function updateForceLane() {
    const el = $('forceLane');
    if (!el)
        return;
    const f = scene();
    if (!f) { el.innerHTML = ''; return; }
    const rows = [
        [tr('force.command'), f.command ?? 0, '#16805d'],
        [tr('force.delivered'), f.drive?.contactForce ?? f.motorForce ?? 0, '#16805d'],
        [tr('force.external'), f.externalForce || 0, '#b86b16'],
        [tr('force.tip'), f.tipForce || 0, '#b86b16'],
    ];
    el.innerHTML = rows.map(([label, val, color]) => `<div class="force-item" style="color:${color}"><small>${label}</small><strong>${F(val, 2)} N</strong></div>`).join('');
}
function updateChrome() {
    const sample = isSample(), replay = !sample && S.mode === 'replay';
    const r = selected(), c = sample ? calculation() : null;
    $('workerStatus').textContent = tr("m0032", S.latest?.iter ?? 0, S.busy ? tr("m0033") : S.ready ? tr("m0034") : tr("m0035"));
    $('sourceHeading').textContent = sample ? tr("m0036") : replay ? tr("m0037") : tr("m0038");
    $('sourceInfo').textContent = sample ? tr("m0039", sourceName(), S.selected, r?.detail?.batchSize || 0, S.sample + 1) : replay ? (typeof S.replay.name==='function'?S.replay.name():S.replay.name) : `${sourceName(S.appliedSource)} I.${S.applied?.iter || 0} · ${S.followPolicy ? tr("m0040") : tr("m0041")}`;
    $('worldTitle').textContent = sample ? tr("m0042") : replay ? tr("m0043") : tr("m0044");
    $('worldSubtitle').textContent = sample ? tr("m0045") : replay ? tr("m0046") : tr("m0047");
    $('clockBadge').textContent = sample ? 'RECORDED SAMPLE' : replay ? `${$('replaySpeed').value}× REPLAY` : S.env.done && !$('autoReset').checked ? tr("m0048") : S.paused ? tr("m0049") : `RT ${F(S.clock.ratio(), 3)}×`;
    $('clockBadge').className = 'tag' + (sample || replay ? ' neutral' : S.env.done ? ' warn' : '');
    $('liveTransport').hidden = sample || replay;
    $('sampleTransport').hidden = !sample;
    $('replayTransport').hidden = !replay;
    $('worldControls').hidden = sample || replay;
    $('sampleNote').hidden = !sample;
    $('sampleLabel').textContent = tr("m0050", c ? S.sample + 1 : 0, r?.detail?.batchSize || 0);
    $('samplePrev').disabled = !c || S.sample === 0;
    $('sampleNext').disabled = !c || S.sample >= r.detail.batchSize - 1;
    $('positiveSample').disabled = $('negativeSample').disabled = !c;
    $('sampleNote').textContent = c ? tr("m0051", c.q.env + 1, Math.floor(c.q.id / 16), c.q.action ? tr("m0052") : tr("m0053")) : tr("m0054");
    $('playWorld').textContent = S.paused ? '▶' : 'Ⅱ';
    $('episodeText').textContent = `${S.env.steps} step · ${F(S.env.steps * DT, 2)} s`;
    $('applySelected').disabled = !r;
    if (replay) {
        $('replaySlider').max = S.replay.trace.length - 1;
        $('replaySlider').value = S.replayAt;
        $('replayPlay').textContent = S.replayPlaying ? 'Ⅱ' : '▶';
        $('replayBack').disabled = S.replayAt === 0;
        $('replayNext').disabled = S.replayAt === S.replay.trace.length - 1;
        $('replayPosition').textContent = `${S.replayAt + 1} / ${S.replay.trace.length}`;
    }
    const f = scene();
    $('worldValues').innerHTML = f ? [[tr("m0055"), F(f.s[0], 3)], [tr("m0056"), F(f.s[1], 3)], [tr("m0057"), F(f.s[2] * 180 / Math.PI, 2)], [tr("m0058"), F(f.s[3], 3)], [tr("m0059"), F(f.reward, 4)]].map(([k, v]) => `<div><small>${k}</small><strong>${v}</strong></div>`).join('') : tr("m0060");
    const ended = !sample && !replay && S.env.done;
    $('worldOverlay').hidden = !ended;
    $('worldOverlay').textContent = ended ? (S.env.validityLimit ? tr("m0061") : S.env.terminated ? tr("m0062", Math.abs(S.env.s[0]) > 2.4 ? tr("m0063") : tr("m0064")) : tr("m0065")) + ($('autoReset').checked ? tr("m0066") : tr("m0067")) : '';
    updateControlStatus();
    updateForceLane();
    $('footerSource').textContent = sample ? tr("m0068", sourceName(), S.selected, S.sample + 1) : tr("m0069");
}
function render() {
    const t = CHAPTERS[S.chapter];
    $('chapterTag').textContent = `0${S.chapter} / 05 · ${t[0]}`;
    $('chapterTitle').textContent = S.chapter === 1 ? tr('tip.title') : t[1];
    $('recordPicker').open = isSample();
    $('lessonTitle').textContent = t[2];
    $('lessonSubtitle').textContent = t[3];
    $('lessonTag').textContent = isSample() ? `${sourceName()} I.${S.selected}` : tr("m0070");
    $('prevChapter').disabled = S.chapter === 1;
    $('nextChapter').disabled = S.chapter === 5;
    document.querySelectorAll('[data-chapter]').forEach(b => { b.classList.toggle('active', +b.dataset.chapter === S.chapter); b.setAttribute('aria-current', +b.dataset.chapter === S.chapter ? 'step' : 'false'); });
    if (S.chapter === 1)
        renderEnvironment();
    if (S.chapter === 2)
        renderNetworks();
    if (S.chapter === 3)
        renderSignal();
    if (S.chapter === 4)
        renderUpdate();
    if (S.chapter === 5)
        renderExperiment();
    updateChrome();
    drawWorld();
    drawAux();
}
function emptyLesson() { $('lessonBody').innerHTML = tr("m0071"); $('support').innerHTML = tr("m0072"); $('support').className = 'support single'; }
function flowBox(label, value, sub = '') { return `<div class="flow-box"><small>${label}</small><strong>${value}</strong>${sub ? `<em>${sub}</em>` : ''}</div>`; }
function collectionContext(c) { return S.netMode === 'delta' && !c.inferenceOnly ? { ...c, models: c.models, fa: c.fa, fc: c.fc } : { ...c, models: c.collectionModels, fa: c.collectionPass.actor, fc: c.collectionPass.critic }; }
function signedStyle(value, max = 1) { const k = Math.min(1, Math.abs(value) / Math.max(max, 1e-12)); return { color: value >= 0 ? '#287ac1' : '#c66c2f', opacity: .055 + .3 * k, width: .45 + 1.3 * k }; }
function liveNetworkContext() { const f = scene(); if (!f)
    return null; const models = { actor: S.actor, critic: S.critic }, fa = models.actor.forward(f.obs), fc = models.critic.forward(f.obs); return { inferenceOnly: true, q: { obs: f.obs, action: f.action, plant: S.env.spec }, models, fa, fc, collectionModels: models, collectionPass: { actor: fa, critic: fc }, collectionP: probabilities(fa.y), record: { before: { iter: S.applied?.iter || 0 } } }; }
function networkSVG(c, kind) {
    const cc = collectionContext(c), m = cc.models[kind], pass = kind === 'actor' ? cc.fa : cc.fc, out = kind === 'actor' ? probabilities(pass.y) : Array.from(pass.y), sel = S.kind === kind, isDelta = S.netMode === 'delta' && !c.inferenceOnly;
    const after = isDelta ? c.after[kind] : null, dw = isDelta ? m.p.map((v, k) => after.p[k] - v) : null, max = isDelta ? Math.max(1e-8, ...dw.map(Math.abs)) : 1;
    const hAfter = after?.forward(c.q.obs).h, hy = Array.from({ length: 16 }, (_, i) => 24 + i * 12.7), ys = kind === 'actor' ? [89, 164] : [123], ins = [42, 84, 126, 168, 210];
    let svg = tr("m0086", kind, S.netMode, C.muted, C.muted, isDelta ? tr("m0087") : tr("m0088"), C.muted, kind === 'actor' ? tr("m0089") : tr("m0090"));
    const edge = (x, y, xx, yy, k, chosen) => { const val = isDelta ? dw[k] : m.p[k], st = signedStyle(val, max); return `<line data-weight-index="${k}" data-encoded="${val}" x1="${x}" y1="${y}" x2="${xx}" y2="${yy}" stroke="${st.color}" opacity="${st.opacity}" stroke-width="${st.width}"/>${chosen ? `<line x1="${x}" y1="${y + 2}" x2="${xx}" y2="${yy + 2}" stroke="#614c91" stroke-width="1" stroke-dasharray="3 3"/>` : ''}`; };
    for (let h = 0; h < 16; h++) {
        for (let j = 0; j < 5; j++)
            svg += edge(75, ins[j], 178, hy[h], h * 5 + j, sel && h === S.neuron && j === S.input);
        for (let k = 0; k < m.o; k++)
            svg += edge(178, hy[h], 280, ys[k], m.w2 + k * 16 + h, sel && h === S.neuron);
    }
    c.q.obs.forEach((val, j) => { const st = signedStyle(val); svg += `<text x="2" y="${ins[j] + 3}" font-size="9" fill="${C.ink}">o${j + 1} ${F(val, 2)}</text><circle cx="75" cy="${ins[j]}" r="6" fill="${st.color}" fill-opacity="${st.opacity}"/>`; });
    for (let h = 0; h < 16; h++) {
        const active = sel && h === S.neuron, val = isDelta ? hAfter[h] - pass.h[h] : pass.h[h], st = signedStyle(val, isDelta ? Math.max(1e-8, ...hAfter.map((v, k) => Math.abs(v - pass.h[k]))) : 1);
        svg += `<g class="hidden-node" data-neuron="${h}" data-kind="${kind}" tabindex="0" role="button" aria-label="${kind} h${h + 1} ${val}"><title>h${h + 1}: ${val}</title><rect x="161" y="${hy[h] - 6}" width="75" height="12.5" fill="transparent"/><circle data-value="${val}" cx="178" cy="${hy[h]}" r="5" fill="${st.color}" fill-opacity="${st.opacity}" stroke="${active ? '#614c91' : st.color}" stroke-width="${active ? 2 : 0.4}"/><text x="${active ? 158 : 190}" y="${hy[h] + 3}" text-anchor="${active ? 'end' : 'start'}" font-size="${active ? 8.8 : 8}" fill="${C.ink}">${active ? 'h' + (h + 1) : F(val, 2)}</text></g>`;
    }
    ys.forEach((y, k) => { const newout = isDelta ? (kind === 'actor' ? c.afterP[k] : c.afterV) : out[k]; svg += `<circle cx="280" cy="${y}" r="8" fill="#e6f0fa" stroke="${C.blue}"/><text x="291" y="${y - 3}" fill="${C.ink}" font-size="9">${kind === 'actor' ? (k ? 'R' : 'L') : 'V'}</text><text x="291" y="${y + 11}" fill="${C.ink}" font-size="9">${F(out[k], 3)}</text>${isDelta ? `<text x="288" y="${y + 25}" fill="#614c91" font-size="8">→ ${F(newout, 3)}</text>` : ''}`; });
    return svg + `<text x="8" y="238" fill="${C.muted}" font-size="8">${isDelta ? tr("m0091") + NUM(max) + tr("m0092") : tr("m0093")}</text></svg>`;
}
function renderNetworks() {
    const c = S.netLive ? liveNetworkContext() : calculation();
    if (!c)
        return emptyLesson();
    const names = [tr("m0094"), tr("m0095"), 'tanh', tr("m0096"), tr("m0097")];
    $('lessonBody').innerHTML = tr("m0098", S.netMode === 'activation' ? 'selected' : '', S.netMode === 'delta' ? 'selected' : '', S.netLive ? 'checked' : '', names.map((n, i) => `<button data-forward="${i}" class="${S.forward === i ? 'active' : ''}">${i + 1} ${n}</button>`).join(''), S.calcPlaying ? 'Ⅱ' : '▶', ['actor', 'critic'].map(kind => `<div class="network-panel ${S.kind === kind ? 'selected' : ''}"><div class="network-head"><button data-kind-select="${kind}">${kind === 'actor' ? tr("m0099") : tr("m0100")}</button><small>5 → 16 → ${kind === 'actor' ? 2 : 1}</small></div>${networkSVG(c, kind)}<div class="network-bottom"><span>${kind === 'actor' ? 'logits → softmax' : tr("m0101")}</span><span class="chip">${kind === 'actor' ? '130' : '113'} parameters</span></div></div>`).join(''));
    $('support').className = 'support single';
    $('support').innerHTML = `<article id="neuronMicroscope"></article>`;
    bindNetworkClicks();
    document.querySelectorAll('[data-forward]').forEach(b => b.onclick = () => { S.forward = +b.dataset.forward; S.calcPlaying = false; renderNetworks(); });
    $('forwardPlay').onclick = () => { S.calcPlaying = !S.calcPlaying; S.calcElapsed = 0; $('forwardPlay').textContent = S.calcPlaying ? 'Ⅱ' : '▶'; };
    $('netMode').onchange = e => { releaseHold(); S.netMode = e.target.value; S.netLive = false; render(); };
    $('netLive').onchange = e => { releaseHold(); S.netLive = e.target.checked; S.netMode = 'activation'; S.lastTs = null; render(); };
    renderNeuron(c);
}
function bindNetworkClicks() { document.querySelectorAll('[data-neuron]').forEach(g => { const pick = () => { S.neuron = +g.dataset.neuron; S.kind = g.dataset.kind; S.weight = S.neuron * 5 + S.input; S.forward = 1; S.calcPlaying = false; renderNetworks(); }; g.onclick = pick; g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    pick();
} }; }); document.querySelectorAll('[data-kind-select]').forEach(b => b.onclick = () => { S.kind = b.dataset.kindSelect; S.weight = S.neuron * 5 + S.input; renderNetworks(); }); }
function renderNeuron(c) {
    const cc = collectionContext(c), kind = S.kind, n = Lesson.neuron(cc, kind, S.neuron), model = cc.models[kind], pass = kind === 'actor' ? cc.fa : cc.fc, el = $('neuronMicroscope'), title = `${kind === 'actor' ? 'Actor' : 'Critic'} · h${S.neuron + 1} · ${c.inferenceOnly ? tr("m0102") : S.netMode === 'delta' ? tr("m0103") : tr("m0104")} I.${c.record.before.iter}`;
    const messages = [tr("m0105"), tr("m0106"), tr("m0107"), tr("m0108"), tr("m0109")];
    $('forwardTakeaway').textContent = messages[S.forward];
    if (S.forward === 0) {
        el.innerHTML = tr("m0110", title, c.q.obs.map((v, i) => `<div class="term"><small>${[tr("m0111"), tr("m0112"), tr("m0113"), tr("m0114"), tr("m0115")][i]}</small><b>o${i + 1} = ${F(v, 5)}</b></div>`).join(''));
    }
    else if (S.forward <= 2) {
        el.innerHTML = tr("m0116", title, [tr("m0117"), tr("m0118"), tr("m0119")][S.forward], n.terms.map((t, i) => `<div class="term"><small>o${i + 1} × W₁[${S.neuron + 1},${i + 1}]</small>${F(t.input, 3)} × ${F(t.weight, 3)}<b>= ${F(t.product, 4)}</b></div>`).join(''), F(n.bias, 4), F(n.z, 4), S.neuron + 1, F(n.z, 3), F(n.activation, 5));
    }
    else {
        let sums = Array.from(pass.y).map((y, k) => `<div class="calculation-cell"><h4>${kind === 'actor' ? (k ? tr("m0120") : tr("m0121")) : tr("m0122")}</h4><div class="mono">Σ (W₂ × h) + b₂ = ${F(y, 5)}</div></div>`).join('');
        el.innerHTML = `<h3>${title} — ${S.forward === 3 ? tr("m0123") : tr("m0124")}</h3><div class="calculation-row">${sums}</div><div class="math-line" style="margin-top:8px">${kind === 'actor' ? tr("m0125", F(probabilities(cc.fa.y)[0] * 100, 2), F(probabilities(cc.fa.y)[1] * 100, 2), c.q.action ? tr("m0052") : tr("m0053")) : tr("m0126", F(pass.y[0], 5))}</div>`;
    }
}
function renderSignal() {
    const c = calculation();
    if (!c)
        return emptyLesson();
    const q = c.q, g = Lesson.gae(q, c.record.hp), parts = q.parts || rewardParts(q.ns, q.goal, c.record.hp.plant);
    $('lessonBody').innerHTML = tr("m0127", q.action ? tr("m0128") : tr("m0129"), [['alive', tr("m0130")], ['position', tr("m0131")], ['velocity', tr("m0132")], ['angle', tr("m0133")]].map(([k, l]) => `<div class="reward-item"><small>${l}</small><strong>${F(parts[k], 4)}</strong></div>`).join(''), F(q.r, 6), q.terminated ? tr("m0134") : q.done ? tr("m0135") : tr("m0136"), F(q.r, 3), F(g.bootstrap, 3), F(q.oldV, 3), NUM(g.delta), NUM(g.delta), NUM(g.future), NUM(q.rawAdv), NUM(q.ret), NUM(q.adv));
    $('support').className = 'support';
    $('support').innerHTML = tr("m0137", NUM(q.rawAdv), NUM(q.adv), q.action ? tr("m0128") : tr("m0129"), q.adv >= 0 ? tr("m0138") : tr("m0139"));
    $('signalNext').onclick = () => setChapter(4);
    drawValueComparison();
}
function updateButtons() { const names = [tr("m0140"), tr("m0141"), tr("m0142"), tr("m0143"), tr("m0144")]; return tr("m0145", names.map((x, i) => `<button data-update="${i}" class="${S.update === i ? 'active' : ''}">${i + 1} ${x}</button>`).join(''), S.calcPlaying ? 'Ⅱ' : '▶'); }
function weightControls(c) { const m = c.models[S.kind]; return tr("m0146", S.kind === 'actor' ? 'selected' : '', S.kind === 'critic' ? 'selected' : '', Array.from(m.p, (_, i) => `<option value="${i}" ${S.weight === i ? 'selected' : ''}>${Lesson.name(m, i)}</option>`).join('')); }
function renderUpdate() {
    const c = calculation();
    if (!c)
        return emptyLesson();
    S.weight = Math.min(S.weight, c.models[S.kind].p.length - 1);
    const q = c.q, w = Lesson.weight(c, S.kind, S.weight);
    let body = updateButtons(), support = '';
    if (S.update === 0) {
        body += tr("m0147", Array.from({ length: 16 }, () => '<div>128</div>').join(''), c.d.batchData.slice(0, 4).map(s => `<tr><td>${s.id}</td><td>${F(s.obs[0], 3)}</td><td>${s.action ? tr("m0128") : tr("m0129")}</td><td>${F(s.r, 4)}</td><td>${F(s.adv, 4)}</td></tr>`).join(''));
        support = tr("m0148", flowBox(tr("m0149"), '2,048 step', tr("m0150")), flowBox(tr("m0151"), '16 batches × 4', tr("m0152")), flowBox(tr("m0153"), tr("m0154"), tr("m0155")), c.record.iter, c.d.epoch, c.d.batch, probRow(tr("m0156"), Math.exp(q.oldLogp), C.muted), probRow(tr("m0157"), c.pa[q.action], C.blue), probRow(tr("m0158"), c.afterP[q.action], C.green));
    }
    else if (S.update === 1) {
        body += tr("m0159", F(c.pa[q.action], 5), F(Math.exp(q.oldLogp), 5), F(c.loss.ratio, 5), NUM(c.loss.loss), F(c.fc.y[0], 4), F(q.ret, 4), NUM(.5 * (c.fc.y[0] - q.ret) ** 2), c.loss.active ? tr("m0160") : tr("m0161"));
        support = tr("m0162", F(q.adv, 3), c.record.hp.epsilon);
    }
    else if (S.update === 2) {
        body += weightControls(c);
        const isA = S.kind === 'actor';
        body += tr("m0163", isA ? 'PPO Actor loss' : 'Critic value loss', isA ? 'Actor' : 'Critic', w.label, NUM(w.single), isA ? '[' + c.loss.dy.map(NUM).join(', ') + ']' : NUM(c.fc.y[0] - q.ret), S.neuron + 1, NUM(c.dz[S.kind][S.neuron]));
        support = tr("m0164", NUM(w.single), NUM(w.G));
    }
    else if (S.update === 3) {
        body += weightControls(c) + tr("m0165", flowBox(tr("m0166"), NUM(w.G)), flowBox(tr("m0167"), F(w.scale, 5)), flowBox(tr("m0168"), NUM(w.g)), NUM(w.m0), NUM(w.g), NUM(w.m), NUM(w.v0), NUM(w.v), NUM(w.delta), w.t, NUM(w.mhat), NUM(w.vhat), w.lr);
        support = tr("m0169", flowBox(tr("m0170") + w.label, NUM(w.before)), flowBox(tr("m0171"), NUM(w.delta)), flowBox(tr("m0172"), NUM(w.after)), NUM(w.delta));
    }
    else {
        const action = q.action ? tr("m0128") : tr("m0129"), dp = c.afterP[q.action] - c.pa[q.action];
        body += tr("m0173", action, probRow(tr("m0174"), c.pa[q.action], C.blue), probRow(tr("m0175"), c.afterP[q.action], C.green), NUM(q.adv), q.adv >= 0 ? tr("m0176") : tr("m0177"), dp >= 0 ? '+' : '', F(dp * 100, 5), dp * q.adv >= 0 ? tr("m0178") : tr("m0179"), dp * q.adv >= 0 ? tr("m0180") : tr("m0181"));
        support = tr("m0182", flowBox(tr("m0183"), F(c.fc.y[0], 5)), flowBox(tr("m0184"), F(q.ret, 5)), flowBox(tr("m0185"), F(c.afterV, 5)));
    }
    $('lessonBody').innerHTML = body;
    $('support').className = 'support';
    $('support').innerHTML = support;
    document.querySelectorAll('[data-update]').forEach(b => b.onclick = () => { S.update = +b.dataset.update; S.calcPlaying = false; renderUpdate(); drawAux(); });
    $('updatePlay').onclick = () => { S.calcPlaying = !S.calcPlaying; S.calcElapsed = 0; $('updatePlay').textContent = S.calcPlaying ? 'Ⅱ' : '▶'; };
    if ($('weightKind'))
        $('weightKind').onchange = e => { S.kind = e.target.value; S.weight = Math.min(S.weight, c.models[S.kind].p.length - 1); renderUpdate(); };
    if ($('weightIndex'))
        $('weightIndex').onchange = e => { S.weight = +e.target.value; const m = c.models[S.kind]; if (S.weight < m.b1) {
            S.neuron = Math.floor(S.weight / 5);
            S.input = S.weight % 5;
        }
        else if (S.weight < m.w2)
            S.neuron = S.weight - m.b1;
        else if (S.weight < m.b2)
            S.neuron = (S.weight - m.w2) % 16; renderUpdate(); };
    if ($('lrScale'))
        $('lrScale').oninput = e => { const x = +e.target.value; $('lrScaleText').textContent = F(x, 2) + '×'; $('lrWhatIf').textContent = tr("m0186", NUM(w.delta * x), NUM(w.before + w.delta * x)); };
    if ($('testThisPolicy'))
        $('testThisPolicy').onclick = applySelected;
    drawClipPlot();
}
function probRow(label, value, color) { return `<div class="bar-row"><span>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${clip(value, 0, 1) * 100}%;background:${color}"></div></div><span class="value">${F(value * 100, 3)}%</span></div>`; }
function renderExperiment() {
    const p = S.draft;
    const option = (value, text, current) => `<option value="${value}" ${value === current ? 'selected' : ''}>${text}</option>`;
    $('lessonBody').innerHTML = tr("m0187", [20, 60, 120, 240].map(n => option(n, n + ' iterations', S.learningLength)).join(''), C.purple, p.seed, [.0003, .0007, .001].map(n => option(n, String(n), p.lr)).join(''), [.1, .2, .3].map(n => option(n, String(n), p.epsilon)).join(''), [.95, .99, 1].map(n => option(n, String(n), p.gamma)).join(''), [.9, .95, 1].map(n => option(n, String(n), p.lambda)).join(''), [0, .005, .01].map(n => option(n, String(n), p.entropy)).join(''), [1, 2, 5, 10].map(n => option(n, n + ' iterations', S.syncEvery)).join(''), C.blue);
    $('support').className = 'support';
    $('support').innerHTML = tr("m0188", PROFILES.map(n => option(n, PROFILE_LABELS[n], S.env.profile)).join(''));
    $('conditionsHere').onclick = openConditions;
    $('startTraining').onclick = startTraining;
    $('finishTraining').onclick = finishTraining;
    $('oneIteration').onclick = oneIteration;
    $('runLength').onchange = e => S.learningLength = +e.target.value;
    const bindDraft = (id, key, convert = Number) => $(id).onchange = e => { S.draft[key] = convert(e.target.value); };
    bindDraft('seed', 'seed');
    bindDraft('learningRate', 'lr');
    bindDraft('epsilon', 'epsilon');
    bindDraft('gamma', 'gamma');
    bindDraft('lambda', 'lambda');
    bindDraft('entropy', 'entropy');
    $('syncEvery').onchange = e => S.syncEvery = +e.target.value;
    $('newExperiment').onclick = () => { if (!Number.isInteger(S.draft.seed) || S.draft.seed < 0 || S.draft.seed > 4294967295) {
        toast(tr("m0189"));
        return;
    } newExperiment(); };
    $('saveCheckpoint').onclick = () => { if (!S.busy && !S.running)
        S.worker.postMessage({ type: 'checkpoint' }); };
    $('loadCheckpoint').onchange = async (e) => { const file = e.target.files[0]; if (!file)
        return; try {
        if (S.busy || S.running)
            throw new Error(tr("m0190"));
        if (file.size > 2e6)
            throw new Error(tr("m0191"));
        const data = JSON.parse(await file.text());
        restoreTrainer(data);
        S.worker.postMessage({ type: 'restore', data });
    }
    catch (err) {
        toast(tr("m0192") + err.message);
    } e.target.value = ''; };
    $('evaluatePolicy').onclick = evaluateCurrent;
    $('recordedReplay').onclick = replaySelected;
    $('liveProfile').onchange = e => { S.env.configure(e.target.value, 1); resetWorld(); toast(tr("m0193")); };
    $('exportEvaluation').onclick = () => saveJSON({ schema: 'ppo-step-evaluation/v1', ...S.evalMeta, rows: S.evalRows }, 'ppo-step-evaluation.json');
    updateTraining();
    updateEvaluation();
    drawTrainingChart();
}
function updateTraining() {
    if (S.chapter !== 5 || !$('startTraining'))
        return;
    $('inferenceIdentity').innerHTML = tr("m0194", sourceName(S.appliedSource), S.applied?.iter || 0, S.followPolicy ? tr("m0195") : tr("m0196"));
    $('trainingIdentity').textContent = tr("m0197", S.latest?.iter || 0, PROFILE_LABELS[S.activeHp?.plan === 'staged' ? P.STAGES[S.currentCurriculum?.index || 0] : S.activeHp?.profile] || tr("m0198"), S.activeHp?.plant?.actuator || tr("m0199"));
    $('startTraining').disabled = !S.ready || S.finishRequested;
    $('startTraining').textContent = S.running ? tr("m0200") : tr("m0201");
    $('finishTraining').disabled = !S.ready || S.finishRequested;
    $('oneIteration').disabled = !S.ready || S.busy || S.running;
    $('newExperiment').disabled = S.busy || S.running;
    $('saveCheckpoint').disabled = !S.ready || S.busy || S.running;
    $('loadCheckpoint').disabled = S.busy || S.running;
    let col = 0, opt = 0;
    if (S.phase === 'collect')
        col = S.phaseData.samples || 0;
    else if (S.busy || S.latest?.iter > 0)
        col = 2048;
    if (S.phase === 'optimize')
        opt = S.phaseData.completed || 0;
    else if (S.phase === 'evaluate' || !S.busy && S.latest?.iter > 0)
        opt = 64;
    $('collectProgress').style.width = col / 2048 * 100 + '%';
    $('collectCount').textContent = `${col.toLocaleString()} / 2,048`;
    $('optimizeProgress').style.width = opt / 64 * 100 + '%';
    $('optimizeCount').textContent = `${opt} / 64`;
    const names = { idle: tr("m0202"), collect: tr("m0203"), gae: tr("m0204"), optimize: tr("m0205"), evaluate: tr("m0206") };
    $('trainingCaption').textContent = S.finishRequested ? tr("m0207") : tr("m0208", names[S.phase], S.latest?.envSteps?.toLocaleString() || 0, S.running ? tr("m0209") + S.until : tr("m0210"));
    $('evaluationSummary').textContent = S.latest ? tr("m0211", F(S.latest.evaluation.mean, 1), S.latest.evaluation.reached) : '—';
    $('pulseDescription').textContent = tr('tip.testBoundary');
}
function evaluateCurrent() {
    if (S.evalBusy || !S.applied)
        return;
    const r = S.applied;
    S.evalRequest++;
    const request = S.evalRequest;
    S.evalBusy = true;
    S.evalProgress = 0;
    S.evalRows = null;
    S.evalMeta = { policy: `${sourceName(S.appliedSource)} I.${r.iter}`, policySource:S.appliedSource, policyIteration:r.iter, snapshot: { ...copy(r.policy), plant: copy(S.env.spec) }, testSpec: copy(S.env.spec), hp: copy(r.hp), seed: 818181, conditionCount: 4, trialsPerCondition: 12 };
    if (!S.evalWorker) {
        const url = URL.createObjectURL(new Blob([$('engine').textContent, '\n', $('lessonEngine').textContent, '\n', $('workerSource').textContent], { type: 'text/javascript' }));
        S.evalWorker = new Worker(url);
        URL.revokeObjectURL(url);
        S.evalWorker.onmessage = ({ data: m }) => { if (m.request !== S.evalRequest && m.type !== 'error')
            return; if (m.type === 'evaluationProgress') {
            S.evalProgress = m.completed;
            updateEvaluation();
        }
        else if (m.type === 'evaluation') {
            S.evalBusy = false;
            S.evalRows = m.rows;
            updateEvaluation();
        }
        else if (m.type === 'error') {
            S.evalBusy = false;
            toast(tr("m0213") + m.message);
            updateEvaluation();
        } };
        S.evalWorker.onerror = e => { S.evalBusy = false; toast(tr("m0214") + e.message); updateEvaluation(); };
    }
    S.evalWorker.postMessage({ type: 'evaluate', request, policy: r.policy, testSpec: copy(S.env.spec) });
    updateEvaluation();
}
function updateEvaluation() {
    if (S.chapter !== 5 || !$('evaluationRows'))
        return;
    $('evaluatePolicy').disabled = S.evalBusy;
    $('exportEvaluation').disabled = !S.evalRows;
    if (S.evalBusy) {
        $('evaluationMeta').textContent = tr("m0215", policyLabelForEvaluation(), S.evalProgress);
        $('evaluationRows').innerHTML = '<div class="progress-row"><div class="bar-track"><div class="bar-fill" style="width:' + S.evalProgress / 4 * 100 + '%"></div></div></div>';
        return;
    }
    if (!S.evalRows)
        return;
    $('evaluationMeta').textContent = tr("m0216", policyLabelForEvaluation());
    $('evaluationRows').innerHTML = tr("m0217", S.evalRows.map((r, i) => tr("m0218", testConditionName(r.condition.key)+`<small class="muted">${tr('probe.invalid',r.invalid||0)}</small>`, r.condition.key === 'pulse12' ? `<small class="muted">${tr('probe.exposure',r.reachedPulse,r.completedPulse||0)}</small>` : '', r.passed, F(r.mean, 1), i)).join(''));
    $('evaluationRows').insertAdjacentHTML('beforeend',`<p class="inline-note">${tr('probe.legend')}</p>`);
    document.querySelectorAll('[data-test-replay]').forEach(b => b.onclick = () => { const r = S.evalRows[+b.dataset.testReplay]; startReplay(r.first, S.evalMeta.snapshot, ()=>tr("m0220", policyLabelForEvaluation(), testConditionName(r.condition.key))); });
}
function saveJSON(data, filename) { const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
// Canvas figures. Values come from physics, saved samples or explicit equations.
function ctx(canvas) { if (!canvas || !canvas.getClientRects().length)
    return null; const w = canvas.clientWidth, h = canvas.clientHeight, d = Math.min(2, window.devicePixelRatio || 1); if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) {
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
} const g = canvas.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); return { g, w, h }; }
function text(g, t, x, y, color = C.muted, size = 10, align = 'left') { g.fillStyle = color; g.font = `${size}px 'Noto Sans CJK KR','Segoe UI',sans-serif`; g.textAlign = align; g.fillText(String(t), x, y); }
function line(g, x, y, xx, yy, color = C.grid, width = 1, dash = []) { g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash); g.beginPath(); g.moveTo(x, y); g.lineTo(xx, yy); g.stroke(); g.setLineDash([]); }
function round(g, x, y, w, h, fill, r = 5) { g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
const SCENE = { refW: 640, refH: 320, worldScale: 110, centerX: 320, trackX0: 56, trackX1: 584, cartW: 78, cartH: 28, cartY: 202, wheelR: 9, wheelDx: 24, railY: 251, poleLen: 132, poleThick: 7, bg: '#ffffff', cart: '#334155', pole: '#dc5b60', rail: '#cbd5e1' };
function geometry(w, h) { const k = Math.min(w / SCENE.refW, h / SCENE.refH), ox = (w - SCENE.refW * k) / 2, oy = (h - SCENE.refH * k) / 2; return { k, ox, oy, x: rx => ox + rx * k, y: ry => oy + ry * k }; }
function drawWorld() {
    if (!S.env)
        return;
    const a = ctx($('world'));
    if (!a)
        return;
    const { g, w, h } = a, f = scene();
    g.fillStyle = SCENE.bg;
    g.fillRect(0, 0, w, h);
    if (!f) {
        text(g, tr("m0221"), w / 2, h / 2, C.muted, 12, 'center');
        return;
    }
    const s = (!isSample() ? f.ns : f.s) || f.s, { k, x: X, y: Y } = geometry(w, h);
    line(g, X(SCENE.trackX0), Y(SCENE.railY), X(SCENE.trackX1), Y(SCENE.railY), SCENE.rail, Math.max(1, 2 * k));
    for (const x of [-2.4, -1.2, 0, 1.2, 2.4]) {
        const px = SCENE.centerX + x * SCENE.worldScale;
        line(g, X(px), Y(SCENE.railY), X(px), Y(SCENE.railY + 4), SCENE.rail);
        text(g, F(x, 1), X(px), Y(SCENE.railY + 18), C.muted, 9, 'center');
    }
    for (const x of [-2.4, 2.4])
        line(g, X(SCENE.centerX + x * SCENE.worldScale), Y(SCENE.cartY - 40), X(SCENE.centerX + x * SCENE.worldScale), Y(SCENE.railY + 4), '#d7a5a4', Math.max(1, k), [3, 4]);
    const gx = SCENE.centerX + f.goal * SCENE.worldScale;
    line(g, X(gx), Y(20), X(gx), Y(SCENE.railY + 4), '#74b499', Math.max(1, k), [3, 4]);
    const pivotX = SCENE.centerX + s[0] * SCENE.worldScale, poleLen = SCENE.poleLen * ((f.params?.l ?? .5) / .5), tipX = pivotX + Math.sin(s[2]) * poleLen, tipY = SCENE.cartY - Math.cos(s[2]) * poleLen;
    round(g, X(pivotX - SCENE.cartW / 2), Y(SCENE.cartY), SCENE.cartW * k, SCENE.cartH * k, SCENE.cart, 4 * k);
    for (const dx of [-SCENE.wheelDx, SCENE.wheelDx])
        renderWheelMesh(g, X(pivotX + dx), Y(SCENE.railY - SCENE.wheelR), SCENE.wheelR * k, -s[0] / Plant.WHEEL.radius);
    line(g, X(pivotX), Y(SCENE.cartY), X(tipX), Y(tipY), SCENE.pole, Math.max(1, SCENE.poleThick * k));
    g.fillStyle = SCENE.cart;
    g.beginPath();
    g.arc(X(pivotX), Y(SCENE.cartY), Math.max(2, 3 * k), 0, Math.PI * 2);
    g.fill();
}
function plot(canvas, series, domain, ymin, ymax, unit = '', bounds = []) {
    const a = ctx(canvas);
    if (!a)
        return;
    const { g, w, h } = a, L = 34, R = w - 10, T = 12, B = h - 19, xx = x => L + (x - domain[0]) / Math.max(1e-9, domain[1] - domain[0]) * (R - L), yy = y => B - (y - ymin) / (ymax - ymin) * (B - T);
    for (const y of [ymin, (ymin + ymax) / 2, ymax]) {
        line(g, L, yy(y), R, yy(y));
        text(g, Math.abs(y) >= 100 ? F(y, 0) : F(y, 1), L - 4, yy(y) + 3, C.muted, 8, 'right');
    }
    for (const b of bounds)
        line(g, L, yy(b), R, yy(b), C.red, 1, [3, 3]);
    for (const s of series) {
        g.strokeStyle = s.color;
        g.lineWidth = 1.6;
        g.beginPath();
        let first = true;
        for (const p of s.points) {
            if (!Number.isFinite(p[1]))
                continue;
            const x = xx(p[0]), y = yy(p[1]);
            if (first) {
                g.moveTo(x, y);
                first = false;
            }
            else
                g.lineTo(x, y);
        }
        g.stroke();
    }
    text(g, F(domain[0], domain[1] > 100 ? 0 : 1), L, h - 5, C.muted, 8);
    text(g, F(domain[1], domain[1] > 100 ? 0 : 1) + ' ' + unit, R, h - 5, C.muted, 8, 'right');
}
function drawLiveTraces() { const recorded = !isSample() && S.mode === 'replay' && S.replay; const h = recorded ? S.replay.trace.slice(Math.max(0, S.replayAt - 599), S.replayAt + 1).map(f => ({ t: (f.step + 1) * DT, angle: (f.ns || f.s)[2] * 180 / Math.PI, x: (f.ns || f.s)[0], goal: f.goal, cmd: f.command ?? (f.action ? 10 : -10), motor: f.motorForce ?? (f.action ? 10 : -10), external: f.externalForce || 0, tip: f.tipForce || 0 })) : S.liveTrace; for (const id of ['forceTrace', 'testForceTrace', 'angleTrace'])
    if ($(id)) {
        $(id).dataset.source = recorded ? 'replay' : 'live';
        $(id).dataset.points = h.length;
    } const points = key => h.map(t => [t.t, t[key]]), domain = h.length ? [h[0].t, Math.max(h[0].t + 1, h.at(-1).t)] : [0, 1]; const maxForce = Math.max(12, ...h.map(f => Math.abs(f.external)), ...h.map(f => Math.abs(f.motor)), ...h.map(f => Math.abs(f.tip || 0))); const series = [{ points: points('cmd'), color: C.blue }, { points: points('motor'), color: C.green }, { points: points('external'), color: C.amber }, { points: points('tip'), color: C.purple }]; for (const id of ['forceTrace', 'testForceTrace'])
    if ($(id))
        plot($(id), series, domain, -maxForce, maxForce, 's'); if ($('angleTrace')) {
    let max = Math.max(15, ...h.map(f => Math.abs(f.angle)));
    plot($('angleTrace'), [{ points: points('angle'), color: C.blue }], domain, -max, max, 's', [-12, 12]);
} }
function drawTrainingChart() { if (!$('trainChart'))
    return; plot($('trainChart'), [{ points: S.history.map(r => [r.iter, r.mean]), color: C.green }], [0, Math.max(1, S.latest?.iter || 0)], 0, 500, 'iteration'); }
function drawValueComparison() { if (!$('valueComparison'))
    return; const c = calculation(); if (!c)
    return; const a = ctx($('valueComparison')); if (!a)
    return; const { g, w, h } = a, vals = [c.q.oldV, c.q.ret], max = Math.max(1, ...vals.map(Math.abs)), center = 24, avail = w - 160; [[tr("m0227"), vals[0], C.blue], [tr("m0228"), vals[1], C.amber]].forEach(([name, val, color], i) => { let y = center + i * 44; text(g, name, 4, y + 13, C.muted, 10); round(g, 111, y + 3, avail, 13, '#f0f3f7', 3); round(g, 111, y + 3, Math.abs(val) / max * avail, 13, color, 3); text(g, F(val, 5), w - 3, y + 14, C.ink, 11, 'right'); }); text(g, tr("m0229"), w - 3, h - 4, C.muted, 9, 'right'); }
function drawClipPlot() { if (!$('clipPlot'))
    return; const c = calculation(); if (!c)
    return; const { g, w, h } = ctx($('clipPlot')), L = 38, R = w - 12, T = 15, B = h - 22, adv = c.q.adv, eps = c.record.hp.epsilon, lo = Math.min(.5, c.loss.ratio - .1), hi = Math.max(1.5, c.loss.ratio + .1), raw = r => r * adv, sur = r => Math.min(r * adv, clip(r, 1 - eps, 1 + eps) * adv); let min = Math.min(raw(lo), raw(hi), 0), max = Math.max(raw(lo), raw(hi), .05), pad = (max - min) * .12; min -= pad; max += pad; const xx = r => L + (r - lo) / (hi - lo) * (R - L), yy = v => B - (v - min) / (max - min) * (B - T); line(g, L, B, R, B); for (const r of [1 - eps, 1, 1 + eps]) {
    line(g, xx(r), T, xx(r), B, '#ccd9e5', 1, [3, 3]);
    text(g, F(r, 1), xx(r), h - 7, C.muted, 9, 'center');
} line(g, xx(lo), yy(raw(lo)), xx(hi), yy(raw(hi)), '#9eadbe', 1, [3, 3]); g.strokeStyle = C.green; g.lineWidth = 2; g.beginPath(); for (let i = 0; i <= 120; i++) {
    const r = lo + (hi - lo) * i / 120;
    i ? g.lineTo(xx(r), yy(sur(r))) : g.moveTo(xx(r), yy(sur(r)));
} g.stroke(); g.fillStyle = C.purple; g.beginPath(); g.arc(xx(c.loss.ratio), yy(sur(c.loss.ratio)), 4, 0, Math.PI * 2); g.fill(); text(g, tr("m0230"), L, 10, C.muted, 9); text(g, tr("m0231", F(c.loss.ratio, 3), F(adv, 3)), R, 10, C.purple, 9, 'right'); }
function drawAux() { drawLiveTraces(); drawTrainingChart(); drawValueComparison(); drawClipPlot(); }
function animate(timestamp) {
    if (S.lastTs === null)
        S.lastTs = timestamp;
    const elapsed = Math.max(0, (timestamp - S.lastTs) / 1000);
    S.lastTs = timestamp;
    if (!S.hidden) {
        if (!isSample() && S.mode === 'live' && !S.paused && (!S.env.done || $('autoReset').checked))
            S.clock.advance(elapsed, physics);
        if (!isSample() && S.mode === 'replay' && S.replayPlaying) {
            S.replayAcc += elapsed * +$('replaySpeed').value;
            while (S.replayAcc >= DT) {
                S.replayAcc -= DT;
                if (S.replayAt < S.replay.trace.length - 1)
                    S.replayAt++;
                else {
                    S.replayPlaying = false;
                    S.replayAcc = 0;
                    break;
                }
            }
        }
        if (S.calcPlaying && (S.chapter === 2 || S.chapter === 4)) {
            S.calcElapsed += elapsed;
            if (S.calcElapsed >= 2.8) {
                S.calcElapsed = 0;
                const key = S.chapter === 2 ? 'forward' : 'update';
                if (S[key] < 4)
                    S[key]++;
                else
                    S.calcPlaying = false;
                if (S.chapter === 2)
                    renderNetworks();
                else
                    renderUpdate();
            }
        }
        drawWorld();
        if (timestamp - S.lastUI > 130) {
            updateChrome();
            updateEnvironment();
            updateTraining();
            updateHardwareReadout();
            if (S.chapter === 2 && S.netLive && !$('conditions').open && document.activeElement?.id !== 'netMode')
                renderNetworks();
            S.lastUI = timestamp;
        }
        if (timestamp - S.lastChart > 220) {
            drawLiveTraces();
            S.lastChart = timestamp;
        }
    }
    requestAnimationFrame(animate);
}
// User interaction bindings. No input generates fake training metrics.
document.querySelectorAll('[data-chapter]').forEach(b => b.onclick = () => setChapter(+b.dataset.chapter));
$('prevChapter').onclick = () => setChapter(S.chapter - 1);
$('nextChapter').onclick = () => setChapter(S.chapter + 1);
$('experimentBtn').onclick = () => setChapter(5);
$('recordSource').onchange = e => chooseSource(e.target.value);
$('recordSelect').onchange = e => chooseRecord(+e.target.value);
$('applySelected').onclick = applySelected;
$('samplePrev').onclick = () => selectSample(S.sample - 1);
$('sampleNext').onclick = () => selectSample(S.sample + 1);
$('positiveSample').onclick = () => pickSign(1);
$('negativeSample').onclick = () => pickSign(-1);
$('playWorld').onclick = () => { releaseHold(); S.paused = !S.paused; S.lastTs = null; updateChrome(); };
$('singleStep').onclick = () => { releaseHold(); S.paused = true; S.lastTs = null; if (physics())
    S.manualSteps++; updateChrome(); updateEnvironment(); drawWorld(); };
$('resetWorld').onclick = resetWorld;
$('target').oninput = e => setGoal(+e.target.value);
$('targetZero').onclick = () => setGoal(0);
// Held pointer/keyboard ownership is bound by initInteraction(). No click pulse.
$('pushForce').onchange = () => { releaseHold(); updateControlStatus(); };
// Scripted evaluation retains a separately labelled cart-body pulse.
$('timeCap').onchange = () => { syncTimeCap(); S.lastTs = null; updateChrome(); };
$('autoReset').onchange = () => { S.lastTs = null; updateChrome(); };
$('replayBack').onclick = () => { S.replayPlaying = false; S.replayAt = Math.max(0, S.replayAt - 1); updateChrome(); };
$('replayNext').onclick = () => { S.replayPlaying = false; S.replayAt = Math.min(S.replay.trace.length - 1, S.replayAt + 1); updateChrome(); };
$('replayPlay').onclick = () => { if (S.replayAt === S.replay.trace.length - 1)
    S.replayAt = 0; S.replayPlaying = !S.replayPlaying; S.replayAcc = 0; S.lastTs = null; };
$('replaySlider').oninput = e => { S.replayAt = +e.target.value; S.replayPlaying = false; S.replayAcc = 0; updateChrome(); };
$('leaveReplay').onclick = () => { S.mode = 'live'; S.replayPlaying = false; S.lastTs = null; render(); };
$('helpBtn').onclick = () => { releaseHold(); $('notes').showModal(); };
$('closeNotes').onclick = () => { $('notes').close(); };
$('notes').addEventListener('click', e => { if (e.target === $('notes')) {
    const r = $('notes').getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        $('notes').close();
} });
$('world').onpointerdown = e => { if (isSample() || S.mode === 'replay')
    return; const r = $('world').getBoundingClientRect(), geo = geometry(r.width, r.height); if (e.clientY - r.top > r.height * .55) {
    const refX = (e.clientX - r.left - geo.ox) / geo.k;
    setGoal((refX - SCENE.centerX) / SCENE.worldScale);
} };
window.addEventListener('keydown', e => { if ($('notes').open || $('conditions').open || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.repeat)
    return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const d = e.key === 'ArrowLeft' ? -1 : 1;
    if (isSample())
        selectSample(S.sample + d);
    else if (S.mode === 'replay') {
        S.replayPlaying = false;
        S.replayAt = clip(S.replayAt + d, 0, S.replay.trace.length - 1);
    }
    else
        beginHold(e.key, d);
} if (e.code === 'Space' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    if (S.mode === 'live' && !isSample())
        $('playWorld').click();
    else if (!isSample())
        $('replayPlay').click();
} });
document.addEventListener('visibilitychange', () => { releaseHold(); S.hidden = document.hidden; S.lastTs = null; clearTimeout(S.timer); if (!S.hidden)
    schedule(); updateChrome(); });
window.addEventListener('resize', () => { drawWorld(); drawAux(); });
window.PPOStep = Object.freeze({ status: () => ({ heldForce:heldForce(), holdSeconds:HOLD.appliedSeconds, holdImpulse:HOLD.impulse, policyCalls:HOLD.policyCalls, tipForce:S.env?.lastOut?.tipForce||0, failureReason:S.env?.lastOut?.failureReason||null, language: I18n.language, physicsVersion: "planar-bam/2", trainingPlant: copy(S.activeHp?.plant), testPlant: copy(S.env?.spec), trainingPlan: S.activeHp?.plan, curriculum: copy(S.currentCurriculum || null), drive: copy(S.env?.lastOut?.drive || null), netMode: S.netMode, netLive: S.netLive, chapter: S.chapter, source: S.source, record: S.selected, sample: S.sample, sampleID: calculation()?.q.id ?? null, kind: S.kind, neuron: S.neuron, weight: S.weight, forward: S.forward, update: S.update, calcPlaying: S.calcPlaying, ready: S.ready, busy: S.busy, running: S.running, latestIteration: S.latest?.iter || 0, trainingProfile: S.activeHp?.profile, appliedIteration: S.applied?.iter || 0, appliedSource: S.appliedSource, followPolicy: S.followPolicy, mode: isSample() ? 'sample' : S.mode, paused: S.paused, liveStep: S.env?.steps, liveState: S.env?.s.slice(), liveGoal: S.env?.goal, liveTerminated: S.env?.terminated, liveTruncated: S.env?.truncated, physicsSteps: S.physicsCount, manualSteps: S.manualSteps, clockSteps: S.clock.steps, wall: S.clock.wall, sim: S.clock.sim, rt: S.clock.ratio(), debt: S.clock.acc, resets: S.resets, pulseSteps: S.pulseSteps, userForce: S.env?.lastOut?.userForce || 0, autoReset: $('autoReset').checked, timeCap: $('timeCap').checked, replayAt: S.replayAt, replayPlaying: S.replayPlaying, evaluation: S.latest ? { mean: S.latest.evaluation.mean, passed: S.latest.evaluation.reached, tailError: S.latest.evaluation.tailError } : null, evalBusy: S.evalBusy, evalPolicy: policyLabelForEvaluation(), evalRows: S.evalRows ? copy(S.evalRows.map(r => ({ name: r.condition.key, passed: r.passed, mean: r.mean, reachedPulse: r.reachedPulse, completedPulse: r.completedPulse, invalid: r.invalid, failureCounts: r.failureCounts }))) : null, records: DATA.own.size }), record: (i) => DATA.own.has(i) ? copy(DATA.own.get(i)) : null, selected: () => copy(selected()), scene: () => copy(scene()), calculation: () => { const c = calculation(); return c ? { q: copy(c.q), pa: c.pa, collectionP: c.collectionP, afterP: c.afterP, loss: copy(c.loss), weight: Lesson.weight(c, S.kind, Math.min(S.weight, c.models[S.kind].p.length - 1)) } : null; } });
/* EXTENSION */
S.env = new CartPole(new RNG(20260915), { profile: 'nominal', seed: 993581, spec: P.DEFAULT_SPEC });
S.env.enforceTimeLimit = false;
S.env.goal = 0;
apply(DATA.example.get(EXAMPLE_FINAL), 'example', false);
fillRecords();
chooseRecord(EXAMPLE_FINAL);
initializeWorker(false);
initHardware();
initPublicUI();
initInteraction();
initFollowExperience();
requestAnimationFrame(animate);
