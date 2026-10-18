'use strict';
const assert=require('assert'),fs=require('fs'),Lab=require('../src/control_lab_engine');
const actor=JSON.parse(fs.readFileSync('./src/example_robust.json','utf8')).records.at(-1).policy.actor;
const residual=JSON.parse(fs.readFileSync('./artifacts/control_observer_residual.json','utf8'));
function mean(a){return a.reduce((s,v)=>s+v,0)/a.length;}
const controllers=['pid','lqr','linear_mpc','centroidal_mpc','full_nmpc','ppo'];
for(const c of controllers){
  const rs=[1,2,3].map(seed=>Lab.runEpisode({controller:c,observer:'truth',scenario:'nominal',seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:2}));
  assert(rs.every(r=>!r.failed),c+' must survive the fixed nominal truth-state probe');
}
const cp=new Lab.LabPlant({seed:9,scenario:'nominal'}),cent=new Lab.CentroidalMPCController(cp.spec),full=new Lab.FullNMPCController(cp.spec),lin=new Lab.LinearMPCController(cp.spec);
cent.reset();full.reset();lin.reset();
cent.act([0,0,.04,0],0);full.act([0,0,.04,0],0);lin.act([0,0,.04,0],0);
assert.equal(cent.lastPredictionReduced.length,33,'centroidal analogue must expose a 32-step reduced horizon');
assert.equal(cent.lastPrediction.length,33,'centroidal analogue must expose mapped full-state display horizon');
assert(Array.isArray(cent.lastReference)&&cent.lastReference.length===2,'centroidal analogue must generate a downstream reference');
assert.equal(full.lastPrediction.length,31,'full NMPC must expose a 30-step nonlinear horizon');
assert(full.lastIterations>=1&&full.lastIterations<=2,'full NMPC must run bounded iterative solve');
assert(full.lastSolveMs>0,'full NMPC must report actual solve time');
assert.equal(lin.lastPrediction.length,31,'linear MPC must expose a 30-step horizon');
const cNom=[1,2,3].map(seed=>Lab.runEpisode({controller:'centroidal_mpc',observer:'kf',scenario:'nominal',seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:3}));
const cSensor=[1,2,3].map(seed=>Lab.runEpisode({controller:'centroidal_mpc',observer:'kf',scenario:'sensor',seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:3}));
assert(cNom.every(r=>!r.failed),'centroidal analogue should survive nominal fixed probe');
assert(cSensor.every(r=>!r.failed),'centroidal analogue should survive sensor-noise fixed probe');
const nTruth=[1,2,3].map(seed=>Lab.runEpisode({controller:'full_nmpc',observer:'truth',scenario:'nominal',seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:3}));
assert(nTruth.every(r=>!r.failed),'full NMPC should survive nominal truth-state fixed probe');
assert(mean(nTruth.map(r=>r.meanSolveMs))<20,'full NMPC educational solver must remain below the 20 ms control slot on this Node probe');
const topics=require('../src/control_lab_topics');
for(const k of ['centroidal_mpc','full_nmpc','inekf','lin','youm','innkf','coco','focus'])assert(topics.CONTROL_LAB_TOPIC_ORDER.includes(k),'missing topic '+k);
assert(topics.CONTROL_LAB_TOPICS.centroidal_mpc.body.includes('x = [h, q_b, q_j]'),'centroidal Figure formulation missing');
assert(topics.CONTROL_LAB_TOPICS.full_nmpc.body.includes('qddot_j'),'full-order Figure formulation missing');
const html=fs.readFileSync('./control-observer-lab-v2.html','utf8');
for(const token of ['Centroidal-style MPC','Full nonlinear NMPC','CONTROL_LAB_TOPICS','cartpole_set_topic','cartpole_run_probe'])assert(html.includes(token),'built v2 missing '+token);
assert(!/\/\* (STYLE|CORE|ACTOR|RESIDUAL|TOPICS|APP) \*\//.test(html),'v2 build markers must be replaced');
console.log(JSON.stringify({
  nominalControllers:'6/6 controller families passed truth-state fixed probe',
  centroidalNominalFailures:cNom.filter(r=>r.failed).length,
  centroidalSensorFailures:cSensor.filter(r=>r.failed).length,
  fullNmpcTruthFailures:nTruth.filter(r=>r.failed).length,
  fullNmpcMeanSolveMs:mean(nTruth.map(r=>r.meanSolveMs)),
  horizons:{linear:lin.lastPrediction.length-1,centroidal:cent.lastPrediction.length-1,fullNmpc:full.lastPrediction.length-1}
},null,2));
