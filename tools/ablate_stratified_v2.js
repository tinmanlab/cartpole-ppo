'use strict';
// Issue #2 diagnostic: test whether seed sensitivity comes from random episode-family
// allocation. Selection seeds are disjoint from the next qualification holdout.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),E=require('../src/core'),P=require('../src/plant'),R=require('../src/robust_v2');
const seeds=[1111,2222,3333],budget=120,trials=12;
const LANES=['nominal','nominal','nominal','nominal','nominal','tipImpulse','tipImpulse','tipImpulse','tipImpulse','tipHold','tipHold','bodyImpulse','bodyImpulse','mixed','mixed','mixed'];
class StratifiedTrainer extends R.Trainer{
 _makeSlot(i){
  const env=new E.CartPole(new E.RNG((this.seed+1009+i*7919)>>>0),{spec:this.hp.plant,profile:'nominal',seed:(this.seed+700001+i*3571)>>>0});
  const slot={env,history:null,schedule:null,prevAction:0,family:LANES[i],lane:LANES[i],domainRandomized:false};
  this._resetSlot(slot,slot.lane);return slot;
 }
 _resetSlot(slot,family=null){return super._resetSlot(slot,family||slot.lane);}
}
const variants=[
 {name:'random-20',Trainer:R.Trainer,p:.20},
 {name:'stratified-20',Trainer:StratifiedTrainer,p:.20},
 {name:'stratified-25',Trainer:StratifiedTrainer,p:.25},
];
function evalPolicy(snapshot,seedBase){
 const cond=(ratio,duration,mixed=false)=>{let successes=0,steps=0,invalid=0;for(let i=0;i<trials;i++){const r=R.rollout(snapshot,{ratio,duration,mixed,seed:seedBase+i*193,goal:[.8,-.8,0][i%3],sign:i%2?1:-1});successes+=r.success;steps+=r.steps;invalid+=r.modelInvalid;}return{successes,trials,meanSteps:steps/trials,modelInvalid:invalid};};
 return{nominal:cond(0,.1),tip10:cond(.1,.1),mixed35:cond(.35,.12,true)};
}
function agg(runs,key){return{successes:runs.reduce((s,r)=>s+r.eval[key].successes,0),trials:runs.length*trials,meanSteps:E.avg(runs.map(r=>r.eval[key].meanSteps)),modelInvalid:runs.reduce((s,r)=>s+r.eval[key].modelInvalid,0)};}
const results=[];
for(const v of variants){console.log('variant',v.name);const runs=[];for(const seed of seeds){console.log(' seed',seed);const t=new v.Trainer(seed,{plant:P.DEFAULT_SPEC,domainRandomizationProb:v.p});for(let i=0;i<budget;i++)t.iteration();runs.push({seed,boundary:t.boundary.value,eval:evalPolicy(t.snapshot(),22_000_000+seed*1000)});}const aggregate={nominal:agg(runs,'nominal'),tip10:agg(runs,'tip10'),mixed35:agg(runs,'mixed35')};results.push({...v,p:v.p,runs,aggregate});console.log(JSON.stringify({name:v.name,p:v.p,aggregate}));}
const eligible=results.filter(x=>x.name!=='random-20'&&x.aggregate.nominal.successes>=30&&x.aggregate.tip10.successes>=30).sort((a,b)=>b.aggregate.mixed35.successes-a.aggregate.mixed35.successes||a.p-b.p);
const selected=eligible[0]?.name??null;
const report={schema:'cartpole-robust-v2-stratified-selection/v1',generatedAt:new Date().toISOString(),method:{selectionSeeds:seeds,nextHoldoutSeeds:[4444,5555,6666],budgetIterations:budget,trialsPerCondition:trials,lanes:LANES,rule:'among stratified candidates require nominal>=30/36 and tip10>=30/36; maximize mixed35; lower DR breaks ties'},selected,results:results.map(({Trainer,...x})=>x)};
fs.mkdirSync(path.join(ROOT,'evidence'),{recursive:true});fs.writeFileSync(path.join(ROOT,'evidence','stratified_v2_ablation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({selected,candidates:report.results.map(x=>({name:x.name,p:x.p,aggregate:x.aggregate}))},null,2));
