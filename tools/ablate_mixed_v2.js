'use strict';
// Phase-3 diagnostic for issue #2. Disturbance family and dynamics randomization
// stay factorized; only the probability of adding reset-level dynamics
// randomization to a non-nominal single-disturbance episode changes.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),E=require('../src/core'),P=require('../src/plant'),R=require('../src/robust_v2');
const seeds=(process.env.ABLATION_SEEDS||'123,456,789').split(',').map(Number);
const budget=Number(process.env.ABLATION_ITERATIONS||120),trials=Number(process.env.ABLATION_TRIALS||12);
if(!seeds.length||seeds.some(x=>!Number.isInteger(x))||!Number.isInteger(budget)||budget<1||!Number.isInteger(trials)||trials<1)throw Error('Invalid ablation configuration.');
const variants=[
 {name:'factorized-p0.25',domainRandomizationProb:.25},
 {name:'factorized-p0.35',domainRandomizationProb:.35},
 {name:'production-p0.50',domainRandomizationProb:.50},
];
function evalTrials(snapshot,kind,seedBase){let success=0,invalid=0,steps=0;for(let i=0;i<trials;i++){
 const opt={seed:seedBase+i*193,goal:[.8,-.8,0][i%3],sign:i%2?1:-1};
 if(kind==='tip10')Object.assign(opt,{ratio:.10,duration:.10});
 if(kind==='mixed35')Object.assign(opt,{ratio:.35,duration:.12,mixed:true});
 const r=R.rollout(snapshot,opt);success+=r.success;invalid+=r.modelInvalid;steps+=r.steps;
}return {success,trials,meanSteps:steps/trials,modelInvalid:invalid};}
function train(seed,cfg){const t=new R.Trainer(seed,{plant:P.DEFAULT_SPEC,domainRandomizationProb:cfg.domainRandomizationProb});let resets=0,randomized=0;const seen=new Array(t.slots.length).fill(null);
 for(let i=0;i<budget;i++){const rec=t.iteration();for(const q of rec.data){if(q.env===undefined)continue;const key=`${q.family}:${q.domainRandomized}`;if(seen[q.env]!==key){seen[q.env]=key;resets++;if(q.domainRandomized)randomized++;}}}
 const snap=t.snapshot(),base=9_000_000+seed*1000;return {seed,budget,boundary:t.boundary.value,boundaryIndex:t.boundary.index,lastGate:t.gateResult,observedRandomizedEpisodeFraction:resets?randomized/resets:null,nominal:evalTrials(snap,'nominal',base),tip10:evalTrials(snap,'tip10',base+100000),mixed35:evalTrials(snap,'mixed35',base+200000)};}
function aggregate(runs,key){return {successes:runs.reduce((s,r)=>s+r[key].success,0),trials:runs.reduce((s,r)=>s+r[key].trials,0),modelInvalid:runs.reduce((s,r)=>s+r[key].modelInvalid,0),meanSteps:runs.reduce((s,r)=>s+r[key].meanSteps,0)/runs.length};}
const results=[];
for(const cfg of variants){console.log(`variant ${cfg.name}`);const runs=[];for(const seed of seeds){console.log(`  seed ${seed}`);runs.push(train(seed,cfg));}results.push({variant:cfg,runs,aggregate:{nominal:aggregate(runs,'nominal'),tip10:aggregate(runs,'tip10'),mixed35:aggregate(runs,'mixed35'),meanBoundary:runs.reduce((s,r)=>s+r.boundary,0)/runs.length,observedRandomizedEpisodeFraction:runs.reduce((s,r)=>s+(r.observedRandomizedEpisodeFraction||0),0)/runs.length}});}
const base=results.at(-1).aggregate;for(const r of results)r.deltaVsP050={nominal:r.aggregate.nominal.successes-base.nominal.successes,tip10:r.aggregate.tip10.successes-base.tip10.successes,mixed35:r.aggregate.mixed35.successes-base.mixed35.successes};
const report={schema:'cartpole-robust-v2-mixed-ablation/v3',generatedAt:new Date().toISOString(),method:{seeds,budgetIterations:budget,trialsPerCondition:trials,finalCheckpointOnly:true,conditions:{nominal:'ratio 0',tip10:'authority 0.10, 0.10 s',mixed35:'mixed physical randomization + authority 0.35, 0.12 s'},rationale:'p=.50 makes about 20% always-mixed + 25% factorized single-disturbance episodes randomized (~45% total). p=.25 and .35 test lower exposure without re-coupling dynamics to disturbance family.'},results};
fs.mkdirSync(path.join(ROOT,'evidence'),{recursive:true});fs.writeFileSync(path.join(ROOT,'evidence','mixed_v2_ablation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({variant:r.variant.name,aggregate:r.aggregate,deltaVsP050:r.deltaVsP050,finalBoundaries:r.runs.map(x=>x.boundary)})),null,2));
