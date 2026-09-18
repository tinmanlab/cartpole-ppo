'use strict';
// Issue #2 diagnostic: isolate whether failures come from dynamics randomization
// exposure or from the coupled edge-goal + outward pole-tip disturbance case.
// Production reward and final-test seeds are unchanged.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),E=require('../src/core'),P=require('../src/plant'),R=require('../src/robust_v2');
const seeds=(process.env.ABLATION_SEEDS||'123,456,789').split(',').map(Number),budget=Number(process.env.ABLATION_ITERATIONS||120),trials=Number(process.env.ABLATION_TRIALS||12);
if(!seeds.length||seeds.some(x=>!Number.isInteger(x))||!Number.isInteger(budget)||budget<1||!Number.isInteger(trials)||trials<1)throw Error('Invalid mixed-recovery ablation configuration.');

const variants=[
 {name:'merged-semantics',dr:0,edge:0,hard:0},
 {name:'factorized-dr-25',dr:.25,edge:0,hard:0},
 {name:'edge-goal-50',dr:.25,edge:.50,hard:0},
 {name:'outward-tip-75',dr:.25,edge:0,hard:.75},
 {name:'edge-50-outward-75',dr:.25,edge:.50,hard:.75},
];

class CandidateTrainer extends R.Trainer{
 _resetSlot(slot,family=null){
  family=family||R.sampleFamily(this.rng);slot.family=family;
  const factorized=family!=='nominal'&&family!=='mixed'&&this.hp.domainRandomizationProb>0&&this.rng.uniform()<this.hp.domainRandomizationProb;
  const randomized=family==='mixed'||factorized;slot.domainRandomized=randomized;
  slot.env.configure(randomized?'mixed':'nominal',randomized?this.boundary.value:0);
  const tipFamily=family==='tipImpulse'||family==='tipHold'||family==='mixed';
  let goal=2*this.rng.uniform()-1;
  if(tipFamily&&this.hp.edgeGoalProb>0&&this.rng.uniform()<this.hp.edgeGoalProb)goal=(this.rng.uniform()<.5?-1:1)*.8;
  slot.env.reset(goal);if(randomized)slot.env.params.pushAmp=0;
  slot.schedule=R.makeEpisodeSchedule(this.rng,slot.env.spec,slot.env.params,this.boundary.value,family);
  if(tipFamily&&Math.abs(goal)>=.6&&this.hp.hardTipProb>0&&this.rng.uniform()<this.hp.hardTipProb){
   const outward=Math.sign(goal)||1;
   for(const event of slot.schedule.events)if(event.kind==='tip')event.force=outward*Math.abs(event.force);
  }
  slot.prevAction=0;slot.history=new R.HistoryBuffer(slot.env.obs(),R.HISTORY_STEPS);
 }
}

function legacyRollout(snapshot,{ratio=0,duration=.1,seed,goal,sign,mixed=false}){
 const actor=E.MLP.from(snapshot.actor),env=new E.CartPole(new E.RNG(seed),{spec:snapshot.plant||P.DEFAULT_SPEC,profile:mixed?'mixed':'nominal',level:mixed?.35:0,seed:(seed+700001)>>>0});env.reset(goal);if(mixed)env.params.pushAmp=0;
 const tipAmp=R.tipForceForAuthority(env.spec,env.params,ratio),start=1,tail=[];
 while(!env.done){const time=env.steps*E.DT,tip=time>=start&&time<start+duration?sign*tipAmp:0,ac=E.policy(actor,env.obs(),true);env.step(ac.a,0,tip);if(env.steps>=350)tail.push(Math.abs(env.s[0]-goal));}
 const tailError=env.steps===500&&tail.length?E.avg(tail):null;
 return {success:!env.terminated&&env.steps===500&&tailError!==null&&tailError<.25,steps:env.steps,modelInvalid:!!env.validityLimit};
}
function robustRollout(snapshot,opt){const r=R.rollout(snapshot,opt);return {success:r.success,steps:r.steps,modelInvalid:r.modelInvalid};}
function evaluate(snapshot,isRobust,seedBase){
 const run=(opt)=>isRobust?robustRollout(snapshot,opt):legacyRollout(snapshot,opt);
 const condition=(key,make)=>{let successes=0,steps=0,invalid=0;for(let i=0;i<trials;i++){const opt={seed:seedBase+i*193,goal:[.8,-.8,0][i%3],sign:i%2?1:-1,...make(i)},r=run(opt);successes+=r.success;steps+=r.steps;invalid+=r.modelInvalid;}return {key,successes,trials,meanSteps:steps/trials,modelInvalid:invalid};};
 return {
  nominal:condition('nominal',()=>({ratio:0,duration:.1})),
  tip10:condition('tip10',()=>({ratio:.10,duration:.10})),
  tip35:condition('tip35',()=>({ratio:.35,duration:.12})),
  mixed35:condition('mixed35',()=>({ratio:.35,duration:.12,mixed:true})),
 };
}
function add(a,b){return {successes:a.successes+b.successes,trials:a.trials+b.trials,meanStepsWeighted:a.meanSteps*a.trials+b.meanSteps*b.trials,modelInvalid:a.modelInvalid+b.modelInvalid};}
function aggregate(runs,key){let a={successes:0,trials:0,meanStepsWeighted:0,modelInvalid:0};for(const r of runs){const q=r.eval[key];a.successes+=q.successes;a.trials+=q.trials;a.meanStepsWeighted+=q.meanSteps*q.trials;a.modelInvalid+=q.modelInvalid;}return {successes:a.successes,trials:a.trials,meanSteps:a.meanStepsWeighted/a.trials,modelInvalid:a.modelInvalid};}

const legacyRuns=[];
for(const seed of seeds){
 console.log('legacy seed',seed);const t=new E.Trainer(seed,{plant:P.DEFAULT_SPEC,profile:'nominal',plan:'fixed'});for(let i=0;i<budget;i++)t.iteration();
 legacyRuns.push({seed,eval:evaluate(t.snapshot(),false,15_000_000+seed*1000)});
}
const legacy={nominal:aggregate(legacyRuns,'nominal'),tip10:aggregate(legacyRuns,'tip10'),tip35:aggregate(legacyRuns,'tip35'),mixed35:aggregate(legacyRuns,'mixed35')};

const results=[];
for(const cfg of variants){
 console.log('variant',cfg.name);const runs=[];
 for(const seed of seeds){
  console.log('  seed',seed);
  const t=new CandidateTrainer(seed,{plant:P.DEFAULT_SPEC,domainRandomizationProb:cfg.dr,edgeGoalProb:cfg.edge,hardTipProb:cfg.hard});
  for(let i=0;i<budget;i++)t.iteration();
  runs.push({seed,boundary:t.boundary.value,eval:evaluate(t.snapshot(),true,15_000_000+seed*1000)});
 }
 const a={nominal:aggregate(runs,'nominal'),tip10:aggregate(runs,'tip10'),tip35:aggregate(runs,'tip35'),mixed35:aggregate(runs,'mixed35')};
 results.push({variant:cfg,runs,aggregate:a,acceptance:{nominal:a.nominal.successes>=legacy.nominal.successes-4,tip10:a.tip10.successes>=legacy.tip10.successes,mixed35:a.mixed35.successes>=legacy.mixed35.successes}});
 console.log(JSON.stringify({variant:cfg.name,aggregate:a,acceptance:results.at(-1).acceptance}));
}
const report={schema:'cartpole-robust-v2-mixed-ablation/v7',generatedAt:new Date().toISOString(),method:{seeds,budgetIterations:budget,trialsPerCondition:trials,finalCheckpointOnly:true,testSeeds:'same across legacy and every candidate; disjoint from training/gates',note:'Edge goal means exactly ±0.8. Hard tip means tip force sign is aligned with goal, which requires recovery toward the nearer outer track side.'},legacy,results};
fs.mkdirSync(path.join(ROOT,'evidence'),{recursive:true});fs.writeFileSync(path.join(ROOT,'evidence','mixed_v2_ablation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({legacy,candidates:results.map(x=>({variant:x.variant.name,aggregate:x.aggregate,acceptance:x.acceptance}))},null,2));
