'use strict';
const assert=require('node:assert/strict');
const E=require('../src/core');
const P=require('../src/plant');
const R=require('../src/robust_v2');
let checks=0;
function test(name,fn){fn();console.log('PASS',name);checks++;}
function near(a,b,tol=1e-8){assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);}

const spec=P.validateSpec({actuator:'ideal',force:8});

test('continuous action maps onto the exact legacy physical command path',()=>{
  const a=new E.CartPole(new E.RNG(11),{spec,seed:22});
  const b=new E.CartPole(new E.RNG(11),{spec,seed:22});
  const d=a.step(1,0,0),c=b.stepContinuous(1,0,0);
  assert.deepEqual(a.s,b.s);assert.equal(d.command,8);assert.equal(c.command,8);
  const z=new E.CartPole(new E.RNG(13),{spec,seed:24});
  assert.equal(z.stepContinuous(0,0,0).command,0);
  assert.throws(()=>z.stepContinuous(1.00001));
});

test('tanh Gaussian policy stays bounded and analytic log-prob gradients match finite differences',()=>{
  const mu=.17,logStd=-.6,z=-.21,adv=.8,eps=.2,entropy=0;
  const base=R.gaussianTerms(mu,logStd,z),oldLogp=base.logp-.03;
  const g=R.gaussianPpoDerivatives(mu,logStd,z,oldLogp,adv,eps,entropy);
  const h=1e-6;
  const f=(m,s)=>R.gaussianPpoLoss(m,s,z,oldLogp,adv,eps,entropy).loss;
  near(g.dMu,(f(mu+h,logStd)-f(mu-h,logStd))/(2*h),2e-6);
  near(g.dLogStd,(f(mu,logStd+h)-f(mu,logStd-h))/(2*h),2e-6);
  const rng=new E.RNG(7),model=new E.MLP(rng,30,32,2,.01),out=R.gaussianPolicy(model,new Array(30).fill(0),false,rng);
  assert.ok(out.action>-1&&out.action<1);assert.ok(Number.isFinite(out.logp));
});

test('five-step history has exact shift semantics',()=>{
  const h=new R.HistoryBuffer([1,2,3,4,5],5);
  assert.equal(h.input().length,30);
  assert.deepEqual(h.input().slice(0,6),[1,2,3,4,5,0]);
  h.append([6,7,8,9,10],.25);
  assert.deepEqual(h.input().slice(-6),[6,7,8,9,10,.25]);
});

test('actor history excludes privileged dynamics while critic suffix changes',()=>{
  const e=new E.CartPole(new E.RNG(9),{spec:P.DEFAULT_SPEC,seed:12});
  const h=new R.HistoryBuffer(e.obs(),5),actor=h.input();
  const p1=R.privilegedInput(e,actor,0,0);
  e.params.mc*=1.2;e.params.gain=.85;
  const p2=R.privilegedInput(e,actor,0,0);
  assert.equal(p1.length,44);assert.equal(p2.length,44);
  assert.deepEqual(p1.slice(0,30),actor);assert.deepEqual(p2.slice(0,30),actor);
  assert.notDeepEqual(p1.slice(30),p2.slice(30));
});

test('tip authority is monotone and invertible inside the training envelope',()=>{
  const env=new E.CartPole(new E.RNG(5),{spec:P.DEFAULT_SPEC,seed:6});
  const r1=R.tipAuthorityRatio(env.spec,env.params,.1),r2=R.tipAuthorityRatio(env.spec,env.params,.2);
  assert.equal(R.tipAuthorityRatio(env.spec,env.params,0),0);assert.ok(r1>0&&r2>r1);
  const f=R.tipForceForAuthority(env.spec,env.params,.35);
  near(R.tipAuthorityRatio(env.spec,env.params,f),.35,1e-7);
});

test('disturbance schedules respect nominal mixture and authority boundary',()=>{
  const rng=new E.RNG(123),env=new E.CartPole(new E.RNG(2),{spec:P.DEFAULT_SPEC,seed:3});
  const counts={nominal:0,tipImpulse:0,tipHold:0,bodyImpulse:0,mixed:0};
  for(let i=0;i<1000;i++){
    const s=R.sampleEpisodeDisturbance(rng,env.spec,env.params,.35);counts[s.family]++;
    for(const ev of s.events){assert.ok(ev.start>=.30);if(ev.kind==='tip')assert.ok(R.tipAuthorityRatio(env.spec,env.params,Math.abs(ev.force))<=.3500001);}
  }
  assert.ok(counts.nominal>240&&counts.nominal<360);
  assert.ok(counts.tipImpulse>190&&counts.tipImpulse<310);
});

test('foundation gate unlocks stable stratified lanes before factorized DR',()=>{
  const t=new R.Trainer(2468,{plant:P.DEFAULT_SPEC});
  assert.equal(t.hp.domainRandomizationProb,.25);assert.equal(t.hp.stratifiedFamilies,true);assert.equal(t.foundation.active,true);
  assert.ok(t.slots.every(s=>s.lane==='nominal'&&s.family==='nominal'));
  t._gradeFoundation(7,8);assert.equal(t.foundation.active,true);
  t._gradeFoundation(7,8);assert.equal(t.foundation.active,false);
  assert.deepEqual(t.slots.map(s=>s.lane),R.STRATIFIED_FAMILIES);
  const counts=Object.fromEntries(Object.keys(R.MIXTURE).map(k=>[k,t.slots.filter(s=>s.lane===k).length]));
  assert.deepEqual(counts,{nominal:5,tipImpulse:4,tipHold:2,bodyImpulse:2,mixed:3});
  let crossFamily=0,nominalRandomized=0,randomized=0;
  for(let i=0;i<100;i++)for(const slot of t.slots){t._resetSlot(slot);assert.equal(slot.family,slot.lane);if(slot.domainRandomized)randomized++;if(slot.family==='nominal'&&slot.domainRandomized)nominalRandomized++;if(!['nominal','mixed'].includes(slot.family)&&slot.domainRandomized)crossFamily++;}
  assert.equal(nominalRandomized,0);assert.ok(crossFamily>130&&crossFamily<270);assert.ok(randomized>420&&randomized<600);
});

test('adaptive boundary promotes only after two good gates and contracts on collapse',()=>{
  const c=new R.AdaptiveBoundary();
  c.grade({nominal:7,tip:6,mixed:6,count:8});assert.equal(c.index,0);assert.equal(c.streak,1);
  c.grade({nominal:8,tip:7,mixed:6,count:8});assert.equal(c.index,1);assert.equal(c.streak,0);
  c.grade({nominal:8,tip:3,mixed:7,count:8});assert.equal(c.index,0);
});

test('one Robust PPO iteration collects 2048 transitions and makes 64 Adam updates',()=>{
  const t=new R.Trainer(123,{plant:P.DEFAULT_SPEC});
  const before=Array.from(t.actor.p);const rec=t.iteration();
  assert.equal(rec.data.length,2048);assert.equal(t.actor.t,64);assert.equal(t.critic.t,64);
  assert.ok(t.actor.p.some((v,i)=>v!==before[i]));
  assert.equal(t.actor.n,30);assert.equal(t.actor.h,32);assert.equal(t.critic.n,44);assert.equal(t.critic.h,64);
});

test('robust checkpoint reproduces the next iteration in one runtime',()=>{
  const t=new R.Trainer(321,{plant:P.DEFAULT_SPEC});t.iteration();const cp=t.checkpoint();
  const a=R.restoreTrainer(cp),b=R.restoreTrainer(cp);a.iteration();b.iteration();
  assert.deepEqual(a.snapshot(),b.snapshot());
});

test('legacy robust-v2 checkpoint without factorized-DR field keeps old future reset semantics',()=>{
  const t=new R.Trainer(654,{plant:P.DEFAULT_SPEC});t.iteration();const cp=t.checkpoint();
  delete cp.hp.domainRandomizationProb;delete cp.hp.stratifiedFamilies;delete cp.hp.foundationCurriculum;delete cp.hp.foundationGateStreak;delete cp.foundation;cp.slots.forEach(s=>delete s.lane);
  const restored=R.restoreTrainer(cp);
  assert.equal(restored.hp.domainRandomizationProb,0);assert.equal(restored.hp.stratifiedFamilies,false);assert.equal(restored.hp.foundationCurriculum,false);assert.equal(restored.foundation.active,false);assert.ok(restored.slots.every(s=>s.lane===null));
});

test('reduced robustness envelope marks ratios above one as stress OOD',()=>{
  const t=new R.Trainer(77,{plant:P.DEFAULT_SPEC});
  const rows=R.evaluateEnvelope(t.snapshot(),{ratios:[0,.5,1,1.25],durations:[.05,.2],trials:2,seed:900});
  assert.equal(rows.length,8);
  assert.equal(rows.filter(x=>x.stressOOD).length,2);
  for(const x of rows){for(const k of ['successes','modelInvalid','maxAngle','maxError','saturationFraction'])assert.ok(Number.isFinite(x[k]));}
});

console.log(JSON.stringify({passed:checks}));
