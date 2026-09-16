'use strict';
// Phase-4 diagnostic for issue #2. p=.25 factorized DR was the best stable
// exposure in phase 3. This experiment asks one question: does a performance-
// gated nominal bootstrap help the weakest seed enter the robust curriculum
// with enough base-control competence, without changing reward or final tests?
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),E=require('../src/core'),P=require('../src/plant'),R=require('../src/robust_v2');
const seeds=(process.env.ABLATION_SEEDS||'123,456,789').split(',').map(Number);
const budget=Number(process.env.ABLATION_ITERATIONS||120),trials=Number(process.env.ABLATION_TRIALS||12);
if(!seeds.length||seeds.some(x=>!Number.isInteger(x))||!Number.isInteger(budget)||budget<1||!Number.isInteger(trials)||trials<1)throw Error('Invalid ablation configuration.');
const variants=[
 {name:'p0.25-no-bootstrap',domainRandomizationProb:.25,bootstrap:false},
 {name:'p0.25-performance-bootstrap',domainRandomizationProb:.25,bootstrap:true},
];
let ACTIVE=null;
class BootstrapTrainer extends R.Trainer{
 constructor(seed,cfg){ACTIVE=cfg;try{super(seed,{plant:P.DEFAULT_SPEC,domainRandomizationProb:cfg.domainRandomizationProb});this.variant=cfg;}finally{ACTIVE=null;}this.bootstrap=cfg.bootstrap;this.bootstrapStreak=0;this.bootstrapUnlockedAt=cfg.bootstrap?null:0;this.bootstrapGates=[];}
 _resetSlot(slot,family=null){const cfg=this.variant||ACTIVE||variants[0],boot=this.bootstrap===undefined?cfg.bootstrap:this.bootstrap;return super._resetSlot(slot,boot?'nominal':family);}
 gate(){
  if(!this.bootstrap)return super.gate();
  const base=(this.seed+900000+this.iter*1009)>>>0,nom=R.evaluateGateFamily(this.snapshot(),'nominal',0,8,base);
  this.bootstrapStreak=nom>=7?this.bootstrapStreak+1:0;
  const result={event:'bootstrap-hold',nominal:nom,tip:0,mixed:0,count:8,boundary:this.boundary.value};
  if(this.bootstrapStreak>=2){this.bootstrap=false;this.bootstrapUnlockedAt=this.iter;this.bootstrapStreak=0;result.event='bootstrap-complete';for(const slot of this.slots)super._resetSlot(slot);}
  this.bootstrapGates.push({iter:this.iter,...result});return result;
 }
}
function evalTrials(snapshot,kind,seedBase){let success=0,invalid=0,steps=0;for(let i=0;i<trials;i++){
 const opt={seed:seedBase+i*193,goal:[.8,-.8,0][i%3],sign:i%2?1:-1};
 if(kind==='tip10')Object.assign(opt,{ratio:.10,duration:.10});
 if(kind==='mixed35')Object.assign(opt,{ratio:.35,duration:.12,mixed:true});
 const r=R.rollout(snapshot,opt);success+=r.success;invalid+=r.modelInvalid;steps+=r.steps;
}return {success,trials,meanSteps:steps/trials,modelInvalid:invalid};}
function train(seed,cfg){const t=new BootstrapTrainer(seed,cfg);for(let i=0;i<budget;i++)t.iteration();const snap=t.snapshot(),base=10_000_000+seed*1000;return {seed,budget,boundary:t.boundary.value,boundaryIndex:t.boundary.index,lastGate:t.gateResult,bootstrapUnlockedAt:t.bootstrapUnlockedAt,bootstrapGates:t.bootstrapGates,nominal:evalTrials(snap,'nominal',base),tip10:evalTrials(snap,'tip10',base+100000),mixed35:evalTrials(snap,'mixed35',base+200000)};}
function aggregate(runs,key){return {successes:runs.reduce((s,r)=>s+r[key].success,0),trials:runs.reduce((s,r)=>s+r[key].trials,0),modelInvalid:runs.reduce((s,r)=>s+r[key].modelInvalid,0),meanSteps:runs.reduce((s,r)=>s+r[key].meanSteps,0)/runs.length};}
const results=[];
for(const cfg of variants){console.log(`variant ${cfg.name}`);const runs=[];for(const seed of seeds){console.log(`  seed ${seed}`);runs.push(train(seed,cfg));}results.push({variant:cfg,runs,aggregate:{nominal:aggregate(runs,'nominal'),tip10:aggregate(runs,'tip10'),mixed35:aggregate(runs,'mixed35'),meanBoundary:runs.reduce((s,r)=>s+r.boundary,0)/runs.length,bootstrapUnlockedAt:runs.map(r=>r.bootstrapUnlockedAt)}});}
const base=results[0].aggregate;for(const r of results)r.deltaVsNoBootstrap={nominal:r.aggregate.nominal.successes-base.nominal.successes,tip10:r.aggregate.tip10.successes-base.tip10.successes,mixed35:r.aggregate.mixed35.successes-base.mixed35.successes};
const report={schema:'cartpole-robust-v2-mixed-ablation/v4',generatedAt:new Date().toISOString(),method:{seeds,budgetIterations:budget,trialsPerCondition:trials,finalCheckpointOnly:true,domainRandomizationProb:.25,bootstrapRule:'Before robust disturbances: nominal >=7/8 at two consecutive 5-iteration gates. Then reset all slots and start the unchanged adaptive robust curriculum.',conditions:{nominal:'ratio 0',tip10:'authority 0.10, 0.10 s',mixed35:'mixed physical randomization + authority 0.35, 0.12 s'}},results};
fs.mkdirSync(path.join(ROOT,'evidence'),{recursive:true});fs.writeFileSync(path.join(ROOT,'evidence','mixed_v2_ablation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({variant:r.variant.name,aggregate:r.aggregate,deltaVsNoBootstrap:r.deltaVsNoBootstrap,finalBoundaries:r.runs.map(x=>x.boundary),unlockedAt:r.runs.map(x=>x.bootstrapUnlockedAt),perSeed:r.runs.map(x=>({seed:x.seed,nominal:x.nominal.success,tip10:x.tip10.success,mixed35:x.mixed35.success,boundary:x.boundary}))})),null,2));
