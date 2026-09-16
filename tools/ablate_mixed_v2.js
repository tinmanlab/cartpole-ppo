'use strict';
// Phase-5 diagnostic for issue #2. Factorized p=.25 preserved nominal/tip and
// nearly recovered mixed performance at I.120. Train once per seed and evaluate
// fixed checkpoints to distinguish under-training from late-stage collapse.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),E=require('../src/core'),P=require('../src/plant'),R=require('../src/robust_v2');
const seeds=(process.env.ABLATION_SEEDS||'123,456,789').split(',').map(Number);
const checkpoints=(process.env.ABLATION_CHECKPOINTS||'120,160,200').split(',').map(Number).sort((a,b)=>a-b),trials=Number(process.env.ABLATION_TRIALS||12),maxIter=checkpoints.at(-1);
if(!seeds.length||seeds.some(x=>!Number.isInteger(x))||checkpoints.some(x=>!Number.isInteger(x)||x<1)||!Number.isInteger(trials)||trials<1)throw Error('Invalid trajectory configuration.');
function evalTrials(snapshot,kind,seedBase){let success=0,invalid=0,steps=0;for(let i=0;i<trials;i++){
 const opt={seed:seedBase+i*193,goal:[.8,-.8,0][i%3],sign:i%2?1:-1};
 if(kind==='tip10')Object.assign(opt,{ratio:.10,duration:.10});
 if(kind==='mixed35')Object.assign(opt,{ratio:.35,duration:.12,mixed:true});
 const r=R.rollout(snapshot,opt);success+=r.success;invalid+=r.modelInvalid;steps+=r.steps;
}return {success,trials,meanSteps:steps/trials,modelInvalid:invalid};}
function score(seed,iter,snapshot,boundary,gate){const base=11_000_000+seed*1000;return {seed,iter,boundary,gate,nominal:evalTrials(snapshot,'nominal',base),tip10:evalTrials(snapshot,'tip10',base+100000),mixed35:evalTrials(snapshot,'mixed35',base+200000)};}
const runs=[];
for(const seed of seeds){console.log(`seed ${seed}: p=.25 to I.${maxIter}`);const t=new R.Trainer(seed,{plant:P.DEFAULT_SPEC,domainRandomizationProb:.25}),points=[];for(let i=1;i<=maxIter;i++){t.iteration();if(checkpoints.includes(i)){const s=score(seed,i,t.snapshot(),t.boundary.value,t.gateResult);points.push(s);console.log(`  I.${i} boundary=${s.boundary.toFixed(2)} nominal=${s.nominal.success}/${trials} tip=${s.tip10.success}/${trials} mixed=${s.mixed35.success}/${trials}`);}}runs.push({seed,points});}
function aggregate(iter,key){const xs=runs.map(r=>r.points.find(p=>p.iter===iter));return {successes:xs.reduce((s,r)=>s+r[key].success,0),trials:xs.reduce((s,r)=>s+r[key].trials,0),modelInvalid:xs.reduce((s,r)=>s+r[key].modelInvalid,0),meanSteps:xs.reduce((s,r)=>s+r[key].meanSteps,0)/xs.length};}
const trajectory=checkpoints.map(iter=>({iter,nominal:aggregate(iter,'nominal'),tip10:aggregate(iter,'tip10'),mixed35:aggregate(iter,'mixed35'),boundaries:runs.map(r=>r.points.find(p=>p.iter===iter).boundary),perSeed:runs.map(r=>{const p=r.points.find(x=>x.iter===iter);return {seed:r.seed,nominal:p.nominal.success,tip10:p.tip10.success,mixed35:p.mixed35.success,boundary:p.boundary};})}));
const report={schema:'cartpole-robust-v2-mixed-ablation/v5',generatedAt:new Date().toISOString(),method:{seeds,checkpoints,trialsPerCondition:trials,domainRandomizationProb:.25,selection:'No checkpoint selected; all predeclared checkpoints are reported on identical held-out seeds.',conditions:{nominal:'ratio 0',tip10:'authority 0.10, 0.10 s',mixed35:'mixed physical randomization + authority 0.35, 0.12 s'}},runs,trajectory};
fs.mkdirSync(path.join(ROOT,'evidence'),{recursive:true});fs.writeFileSync(path.join(ROOT,'evidence','mixed_v2_ablation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(trajectory,null,2));
