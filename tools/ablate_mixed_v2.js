'use strict';
// Issue #2 selection-only sweep. Candidate selection uses seeds disjoint from
// the final qualification seeds. Rule is fixed before results: require
// nominal>=30/36 and tip10>=30/36, maximize mixed35, break ties toward lower DR.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),E=require('../src/core'),P=require('../src/plant'),R=require('../src/robust_v2');
const seeds=[147,258,369],probs=[.15,.20,.25,.30],budget=120,trials=12;
function evaluate(snapshot,seedBase){
 const cond=(ratio,duration,mixed=false)=>{let successes=0,steps=0,invalid=0;for(let i=0;i<trials;i++){const r=R.rollout(snapshot,{ratio,duration,mixed,seed:seedBase+i*193,goal:[.8,-.8,0][i%3],sign:i%2?1:-1});successes+=r.success;steps+=r.steps;invalid+=r.modelInvalid;}return{successes,trials,meanSteps:steps/trials,modelInvalid:invalid};};
 return{nominal:cond(0,.1,false),tip10:cond(.1,.1,false),mixed35:cond(.35,.12,true)};
}
function aggregate(runs,key){return{successes:runs.reduce((s,r)=>s+r.eval[key].successes,0),trials:runs.length*trials,meanSteps:E.avg(runs.map(r=>r.eval[key].meanSteps)),modelInvalid:runs.reduce((s,r)=>s+r.eval[key].modelInvalid,0)};}
const results=[];
for(const p of probs){console.log('DR',p);const runs=[];for(const seed of seeds){console.log(' seed',seed);const t=new R.Trainer(seed,{plant:P.DEFAULT_SPEC,domainRandomizationProb:p});for(let i=0;i<budget;i++)t.iteration();runs.push({seed,boundary:t.boundary.value,eval:evaluate(t.snapshot(),18_000_000+seed*1000)});}const aggregateResult={nominal:aggregate(runs,'nominal'),tip10:aggregate(runs,'tip10'),mixed35:aggregate(runs,'mixed35')};results.push({p,runs,aggregate:aggregateResult});console.log(JSON.stringify({p,aggregate:aggregateResult}));}
const eligible=results.filter(x=>x.aggregate.nominal.successes>=30&&x.aggregate.tip10.successes>=30).sort((a,b)=>b.aggregate.mixed35.successes-a.aggregate.mixed35.successes||a.p-b.p);
const selected=eligible[0]?.p??null;
const report={schema:'cartpole-robust-v2-dr-selection/v1',generatedAt:new Date().toISOString(),method:{selectionSeeds:seeds,finalQualificationSeeds:[123,456,789],budgetIterations:budget,trialsPerCondition:trials,rule:'nominal>=30/36 and tip10>=30/36; maximize mixed35; lower DR breaks ties'},results,selected};
fs.mkdirSync(path.join(ROOT,'evidence'),{recursive:true});fs.writeFileSync(path.join(ROOT,'evidence','mixed_v2_ablation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({selected,candidates:results.map(x=>({p:x.p,aggregate:x.aggregate}))},null,2));
