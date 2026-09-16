'use strict';
// Focused phase-2 ablation for issue #2. Production already has factorized
// reset-level dynamics randomization. This script changes only the mixed gate
// strength, under the same three seeds and 120-iteration final-checkpoint rule.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),E=require('../src/core'),P=require('../src/plant'),R=require('../src/robust_v2');
const seeds=(process.env.ABLATION_SEEDS||'123,456,789').split(',').map(Number);
const budget=Number(process.env.ABLATION_ITERATIONS||120),trials=Number(process.env.ABLATION_TRIALS||12);
if(!seeds.length||seeds.some(x=>!Number.isInteger(x))||!Number.isInteger(budget)||budget<1||!Number.isInteger(trials)||trials<1)throw Error('Invalid ablation configuration.');
const variants=[{name:'production-gate-0.60',mixedGateScale:.60},{name:'full-boundary-mixed-gate',mixedGateScale:1.00}];
function gateFamily(snapshot,family,boundary,count,seed,mixedScale){let passed=0;for(let i=0;i<count;i++){
 const goal=[.8,-.8,0][i%3],sign=i%2?1:-1,opt={seed:seed+i*193,goal,sign};
 if(family==='tip')Object.assign(opt,{ratio:boundary,duration:.12});
 else if(family==='mixed')Object.assign(opt,{ratio:boundary*mixedScale,duration:.12,mixed:true});
 const r=R.rollout(snapshot,opt);if(r.success)passed++;
}return passed;}
class GateTrainer extends R.Trainer{
 constructor(seed,cfg){super(seed,{plant:P.DEFAULT_SPEC});this.variant=cfg;this.gateTrace=[];}
 gate(){const cfg=this.variant,base=(this.seed+900000+this.iter*1009)>>>0,snap=this.snapshot(),before=this.boundary.value,nom=gateFamily(snap,'nominal',before,8,base,cfg.mixedGateScale),tip=gateFamily(snap,'tip',before,8,base+10000,cfg.mixedGateScale),mix=gateFamily(snap,'mixed',before,8,base+20000,cfg.mixedGateScale),grade=this.boundary.grade({nominal:nom,tip,mixed:mix,count:8}),out={...grade,nominal:nom,tip,mixed:mix,testedBoundary:before,mixedGateScale:cfg.mixedGateScale};this.gateTrace.push({iter:this.iter,...out});return out;}
}
function evalTrials(snapshot,kind,seedBase){let success=0,invalid=0,steps=0;for(let i=0;i<trials;i++){
 const opt={seed:seedBase+i*193,goal:[.8,-.8,0][i%3],sign:i%2?1:-1};
 if(kind==='tip10')Object.assign(opt,{ratio:.10,duration:.10});
 if(kind==='mixed35')Object.assign(opt,{ratio:.35,duration:.12,mixed:true});
 const r=R.rollout(snapshot,opt);success+=r.success;invalid+=r.modelInvalid;steps+=r.steps;
}return {success,trials,meanSteps:steps/trials,modelInvalid:invalid};}
function train(seed,cfg){const t=new GateTrainer(seed,cfg);for(let i=0;i<budget;i++)t.iteration();const snap=t.snapshot(),base=8_000_000+seed*1000;return {seed,budget,boundary:t.boundary.value,boundaryIndex:t.boundary.index,lastGate:t.gateResult,gateTrace:t.gateTrace,nominal:evalTrials(snap,'nominal',base),tip10:evalTrials(snap,'tip10',base+100000),mixed35:evalTrials(snap,'mixed35',base+200000)};}
function aggregate(runs,key){return {successes:runs.reduce((s,r)=>s+r[key].success,0),trials:runs.reduce((s,r)=>s+r[key].trials,0),modelInvalid:runs.reduce((s,r)=>s+r[key].modelInvalid,0),meanSteps:runs.reduce((s,r)=>s+r[key].meanSteps,0)/runs.length};}
const results=[];
for(const cfg of variants){console.log(`variant ${cfg.name}`);const runs=[];for(const seed of seeds){console.log(`  seed ${seed}`);runs.push(train(seed,cfg));}results.push({variant:cfg,runs,aggregate:{nominal:aggregate(runs,'nominal'),tip10:aggregate(runs,'tip10'),mixed35:aggregate(runs,'mixed35'),meanBoundary:runs.reduce((s,r)=>s+r.boundary,0)/runs.length}});}
const baseline=results[0].aggregate;
for(const r of results)r.delta={nominal:r.aggregate.nominal.successes-baseline.nominal.successes,tip10:r.aggregate.tip10.successes-baseline.tip10.successes,mixed35:r.aggregate.mixed35.successes-baseline.mixed35.successes};
const report={schema:'cartpole-robust-v2-mixed-ablation/v2',generatedAt:new Date().toISOString(),method:{seeds,budgetIterations:budget,trialsPerCondition:trials,finalCheckpointOnly:true,productionDomainRandomizationProb:R.DEFAULT_HP.domainRandomizationProb,conditions:{nominal:'ratio 0',tip10:'authority 0.10, 0.10 s',mixed35:'mixed physical randomization + authority 0.35, 0.12 s'},hypothesis:'The 0.60x mixed promotion gate permits premature authority-boundary expansion after factorized DR.'},results};
fs.mkdirSync(path.join(ROOT,'evidence'),{recursive:true});fs.writeFileSync(path.join(ROOT,'evidence','mixed_v2_ablation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({variant:r.variant.name,aggregate:r.aggregate,delta:r.delta,finalBoundaries:r.runs.map(x=>x.boundary)})),null,2));
