'use strict';
const assert = require('node:assert/strict');
const {makeI18n} = require('../src/i18n');
const P = require('../src/plant');
const E = require('../src/core');
const L = require('../src/lesson');
const tests=[];
function check(name, f) { f(); tests.push(name); console.log('PASS',name); }
check('English is default; locale change preserves numeric placeholders', () => {
 const i = makeI18n({en:{x:'Force {0} N'},ko:{x:'외력 {0} N'}});
 assert.equal(i.language,'en'); assert.equal(i.t('x',12),'Force 12 N');
 i.setLanguage('ko'); assert.equal(i.t('x',12),'외력 12 N');
 assert.throws(()=>i.setLanguage('xx')); assert.equal(i.language,'ko');
});
check('Unknown message and missing variables fail explicitly',()=>{
 const i=makeI18n({en:{x:'{0}'},ko:{x:'{0}'}});
 assert.throws(()=>i.t('unknown'));assert.throws(()=>i.t('x'));
});
check('Reward settings affect score, not physical transition',()=>{
 const a=new E.CartPole(new E.RNG(20),{spec:P.DEFAULT_SPEC});
 const b=new E.CartPole(new E.RNG(20),{spec:{...P.DEFAULT_SPEC,rewardPosition:2}});
 a.reset(.8);b.reset(.8);let ra=a.step(1),rb=b.step(1);
 assert.deepEqual(a.s,b.s);assert(rb.reward<ra.reward);
 assert.throws(()=>P.validateSpec({rewardAngle:-1}));
});
check('Normal contact force uses pole vertical acceleration, not fixed weight',()=>{
 const s=P.validateSpec(),p=P.sample(s,'nominal',1,new E.RNG(2));
 const v=[0,.12,.1,1.5],o=P.integrate(v,s,p,3,0);
 const expected=(p.mc+p.mp)*s.gravity-p.mp*p.l*(o.drive.alpha*Math.sin(v[2])+v[3]**2*Math.cos(v[2]));
 assert(Math.abs(o.drive.normalForce-expected)<1e-10);
 assert(o.drive.tractionLimit>=0);
});
check('A failed-before-push trial is not a disturbance-recovery result',()=>{
 const t=new E.Trainer(123),r=L.probe(t.snapshot(),'nominal',818181,499,12,10,0);
 assert.equal(r.pulseApplied,0);assert.equal(r.pulseReached,false);
 assert.equal(r.requestedImpulse,2.4);assert.equal(r.deliveredImpulse,0);
 assert.equal(r.recoveryTime,null);assert(r.failureReason);
});
check('Probe rejects invalid magnitudes, indices and duration',()=>{
 const s=new E.Trainer(123).snapshot();
 for(const args of [[-1,4,10],[150,NaN,10],[150,4,-1],[150,100,10]])
  assert.throws(()=>L.probe(s,'nominal',818181,...args));
});
check('Checkpoint refuses mismatched physics version even with a v2 envelope',()=>{
 const cp=E.trainerCheckpoint(new E.Trainer(4)); cp.modelVersion='planar-bam/1';
 assert.throws(()=>E.restoreTrainer(cp));
});
check('Checkpoint rejects nonnumeric curriculum metadata before it reaches HTML',()=>{
 const cp=E.trainerCheckpoint(new E.Trainer(4));
 cp.curriculum.last={iter:0,passed:'<img src=x onerror=alert(1)>',count:8,profile:'nominal'};
 assert.throws(()=>E.restoreTrainer(cp));
 cp.curriculum.last=null;
 cp.curriculum.history=[{iter:0,passed:8,count:8,rate:1,next:'<img src=x>',promoted:false}];
 assert.throws(()=>E.restoreTrainer(cp));
});
check('Checkpoint validates policy provenance separately from future training settings',()=>{
 const cp=E.trainerCheckpoint(new E.Trainer(4));
 cp.trainedPlant.actuator='<img src=x>';
 assert.throws(()=>E.restoreTrainer(cp));
 cp.trainedPlant={...P.DEFAULT_SPEC};cp.trainedProfile='<script>';
 assert.throws(()=>E.restoreTrainer(cp));
});
check('Checkpoint rejects prototype keys at every nesting level',()=>{
 const cp=E.trainerCheckpoint(new E.Trainer(4));
 cp.envs[0].extra=JSON.parse('{"__proto__":{"polluted":true}}');
 assert.throws(()=>E.restoreTrainer(cp));
 assert.equal({}.polluted,undefined);
});
check('Checkpoint learning-statistic annotations must be numeric',()=>{
 const cp=E.trainerCheckpoint(new E.Trainer(4));
 cp.last.adam={before:0,after:0,rawGradient:0,g:0,m:0,v:0,mh:0,vh:0,delta:0,t:'<img src=x>'};
 assert.throws(()=>E.restoreTrainer(cp));
});
require('node:fs').mkdirSync(__dirname+'/../evidence',{recursive:true});
require('node:fs').writeFileSync(__dirname+'/../evidence/public_contract_tests.json',JSON.stringify({passed:tests.length,tests},null,2));
console.log(JSON.stringify({passed:tests.length,tests}));
