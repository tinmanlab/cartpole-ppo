'use strict';

const assert=require('assert'),fs=require('fs'),Lab=require('../src/control_lab_engine');

const actor=JSON.parse(fs.readFileSync('./src/example_robust.json','utf8')).records.at(-1).policy.actor;

const residual=JSON.parse(fs.readFileSync('./artifacts/control_observer_residual.json','utf8'));

function avg(a){return a.reduce((s,v)=>s+v,0)/a.length;}

for(const c of ['pid','lqr','mpc','ppo']){
 const r=Lab.runEpisode({controller:c,observer:'truth',scenario:'nominal',seed:4,steps:300,actor,residualModel:residual,pushAt:120,pushForce:2});
 assert.equal(r.failed,false,c+' should survive nominal truth-state probe');
}

const raw=[],kf=[],adapt=[],so2=[],glitchA=[],glitchS=[];

for(const seed of [1,2,3,4,5]){
 raw.push(Lab.runEpisode({controller:'lqr',observer:'raw',scenario:'sensor',seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:3}));
 kf.push(Lab.runEpisode({controller:'lqr',observer:'kf',scenario:'sensor',seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:3}));
 adapt.push(Lab.runEpisode({controller:'lqr',observer:'adaptive',scenario:'sensor',seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:3}));
 so2.push(Lab.runEpisode({controller:'lqr',observer:'so2',scenario:'sensor',seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:3}));
 glitchA.push(Lab.runEpisode({controller:'lqr',observer:'adaptive',scenario:'glitch',seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:3}));
 glitchS.push(Lab.runEpisode({controller:'lqr',observer:'so2',scenario:'glitch',seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:3}));
}

assert(raw.filter(r=>r.failed).length>=4,'raw finite-difference should expose noise amplification');

assert(kf.every(r=>!r.failed),'KF should survive the fixed sensor-noise probe');

assert(avg(adapt.map(r=>r.rmseState)) < .7*avg(so2.map(r=>r.rmseState)),'adaptive R should materially reduce sensor-noise estimation RMSE');

assert(avg(glitchA.map(r=>r.rmseState)) < avg(glitchS.map(r=>r.rmseState)),'adaptive R should reduce measurement-glitch RMSE');

assert(residual.metrics.residualRmse < .7*residual.metrics.baseRmse,'held-out residual learner must improve offline residual RMSE');

const html=fs.readFileSync('./control-observer-lab.html','utf8');

for(const token of ['CartPole Control × Observer Lab','document.modelContext','cartpole_get_state','SO(2) invariant-error bridge','Hartley','CoCo-InEKF','FOCUS'])assert(html.includes(token),'built lab missing '+token);

assert(!/\/\* (STYLE|CORE|ACTOR|RESIDUAL|APP) \*\//.test(html),'build markers must be fully replaced');

console.log(JSON.stringify({
 controllers:'pid/lqr/mpc/ppo nominal truth probes pass',
 rawSensorFailures:raw.filter(r=>r.failed).length,
 kfSensorFailures:kf.filter(r=>r.failed).length,
 so2SensorRmse:avg(so2.map(r=>r.rmseState)),
 adaptiveSensorRmse:avg(adapt.map(r=>r.rmseState)),
 so2GlitchRmse:avg(glitchS.map(r=>r.rmseState)),
 adaptiveGlitchRmse:avg(glitchA.map(r=>r.rmseState)),
 residualOffline:residual.metrics
},null,2));
