'use strict';
// Diagnostic ablation for issue #2. This script does not alter production
// training behavior. It compares one variable at a time under the same budget,
// seeds and final-test conditions, then writes full evidence for review.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),E=require('../src/core'),P=require('../src/plant'),R=require('../src/robust_v2');
const seeds=(process.env.ABLATION_SEEDS||'123,456,789').split(',').map(Number);
const budget=Number(process.env.ABLATION_ITERATIONS||80),trials=Number(process.env.ABLATION_TRIALS||12);
if(!seeds.length||seeds.some(x=>!Number.isInteger(x))||!Number.isInteger(budget)||budget<1||!Number.isInteger(trials)||trials<1)throw Error('Invalid ablation configuration.');

const BASE_MIX={...R.MIXTURE};
const variants=[
 {name:'baseline',gateMixedScale:.60,mix:BASE_MIX,factorizedDR:0},
 {name:'full-mixed-gate',gateMixedScale:1.00,mix:BASE_MIX,factorizedDR:0},
 {name:'more-mixed-episodes',gateMixedScale:.60,mix:{nominal:.30,tipImpulse:.20,tipHold:.10,bodyImpulse:.10,mixed:.30},factorizedDR:0},
 {name:'factorized-dr',gateMixedScale:.60,mix:BASE_MIX,factorizedDR:.50},
 {name:'factorized-dr-full-gate',gateMixedScale:1.00,mix:BASE_MIX,factorizedDR:.50},
];
let ACTIVE=null;
function gateFamily(snapshot,family,boundary,count,seed,mixedScale){let passed=0;for(let i=0;i<count;i++){
 const goal=[.8,-.8,0][i%3],sign=i%2?1:-1,opt={seed:seed+i*193,goal,sign};
 if(family==='tip')Object.assign(opt,{ratio:boundary,duration:.12});
 else if(family==='mixed')Object.assign(opt,{ratio:boundary*mixedScale,duration:.12,mixed:true});
 const r=R.rollout(snapshot,opt);if(r.success)passed++;
}return passed;}
class VariantTrainer extends R.Trainer{
 constructor(seed,cfg){ACTIVE=cfg;try{super(seed,{plant:P.DEFAULT_SPEC});this.variant=cfg;}finally{ACTIVE=null;}}
 _resetSlot(slot,family=null){
  const cfg=this.variant||ACTIVE||variants[0];family=family||R.sampleFamily(this.rng);slot.family=family;
  const extraDR=family!=='nominal'&&family!=='mixed'&&cfg.factorizedDR>0&&this.rng.uniform()<cfg.factorizedDR;
  const randomized=family==='mixed'||extraDR;
  this.ablationCounts=this.ablationCounts||{resets:0,families:{},domainRandomized:0};this.ablationCounts.resets++;this.ablationCounts.families[family]=(this.ablationCounts.families[family]||0)+1;if(randomized)this.ablationCounts.domainRandomized++;
  slot.env.configure(randomized?'mixed':'nominal',randomized?this.boundary.value:0);slot.env.reset(2*this.rng.uniform()-1);if(randomized)slot.env.params.pushAmp=0;
  slot.schedule=R.makeEpisodeSchedule(this.rng,slot.env.spec,slot.env.params,this.boundary.value,family);slot.prevAction=0;slot.history=new R.HistoryBuffer(slot.env.obs(),R.HISTORY_STEPS);
 }
 gate(){const cfg=this.variant||ACTIVE||variants[0],base=(this.seed+900000+this.iter*1009)>>>0,snap=this.snapshot(),nom=gateFamily(snap,'nominal',this.boundary.value,8,base,cfg.gateMixedScale),tip=gateFamily(snap,'tip',this.boundary.value,8,base+10000,cfg.gateMixedScale),mix=gateFamily(snap,'mixed',this.boundary.value,8,base+20000,cfg.gateMixedScale),grade=this.boundary.grade({nominal:nom,tip,mixed:mix,count:8});return {...grade,nominal:nom,tip,mixed:mix,mixedScale:cfg.gateMixedScale};}
}
function setMix(m){Object.assign(R.MIXTURE,m);const sum=Object.values(R.MIXTURE).reduce((a,b)=>a+b,0);if(Math.abs(sum-1)>1e-12)throw Error('Mixture must sum to one.');}
function evalTrials(snapshot,kind,seedBase){let success=0,invalid=0,steps=0;for(let i=0;i<trials;i++){
 const opt={seed:seedBase+i*193,goal:[.8,-.8,0][i%3],sign:i%2?1:-1};
 if(kind==='tip10')Object.assign(opt,{ratio:.10,duration:.10});
 if(kind==='mixed35')Object.assign(opt,{ratio:.35,duration:.12,mixed:true});
 const r=R.rollout(snapshot,opt);success+=r.success;invalid+=r.modelInvalid;steps+=r.steps;
}return {success,trials,meanSteps:steps/trials,modelInvalid:invalid};}
function train(seed,cfg){setMix(cfg.mix);const t=new VariantTrainer(seed,cfg);for(let i=0;i<budget;i++)t.iteration();const snap=t.snapshot(),base=7_000_000+seed*1000;return {seed,budget,boundary:t.boundary.value,boundaryIndex:t.boundary.index,lastGate:t.gateResult,counts:t.ablationCounts,nominal:evalTrials(snap,'nominal',base),tip10:evalTrials(snap,'tip10',base+100000),mixed35:evalTrials(snap,'mixed35',base+200000)};}
function aggregate(runs,key){return {successes:runs.reduce((s,r)=>s+r[key].success,0),trials:runs.reduce((s,r)=>s+r[key].trials,0),modelInvalid:runs.reduce((s,r)=>s+r[key].modelInvalid,0),meanSteps:runs.reduce((s,r)=>s+r[key].meanSteps,0)/runs.length};}
const results=[];
for(const cfg of variants){console.log(`variant ${cfg.name}`);const runs=[];for(const seed of seeds){console.log(`  seed ${seed}`);runs.push(train(seed,cfg));}results.push({variant:cfg,runs,aggregate:{nominal:aggregate(runs,'nominal'),tip10:aggregate(runs,'tip10'),mixed35:aggregate(runs,'mixed35'),meanBoundary:runs.reduce((s,r)=>s+r.boundary,0)/runs.length,domainRandomizedFraction:runs.reduce((s,r)=>s+r.counts.domainRandomized/r.counts.resets,0)/runs.length}});}
setMix(BASE_MIX);
const baseline=results[0].aggregate;
for(const r of results){r.delta={nominal:(r.aggregate.nominal.successes/r.aggregate.nominal.trials)-(baseline.nominal.successes/baseline.nominal.trials),tip10:(r.aggregate.tip10.successes/r.aggregate.tip10.trials)-(baseline.tip10.successes/baseline.tip10.trials),mixed35:(r.aggregate.mixed35.successes/r.aggregate.mixed35.trials)-(baseline.mixed35.successes/baseline.mixed35.trials)};}
const report={schema:'cartpole-robust-v2-mixed-ablation/v1',generatedAt:new Date().toISOString(),method:{seeds,budgetIterations:budget,trialsPerCondition:trials,finalCheckpointOnly:true,conditions:{nominal:'ratio 0',tip10:'authority 0.10, 0.10 s',mixed35:'mixed physical randomization + authority 0.35, 0.12 s'},note:'Diagnostic only; production behavior is unchanged.'},results};
fs.mkdirSync(path.join(ROOT,'evidence'),{recursive:true});fs.writeFileSync(path.join(ROOT,'evidence','mixed_v2_ablation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({variant:r.variant.name,aggregate:r.aggregate,delta:r.delta})),null,2));
