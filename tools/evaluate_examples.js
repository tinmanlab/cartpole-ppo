'use strict';
// Fixed declared final checkpoints; do not select by held-out performance.
const fs=require('node:fs'),path=require('node:path');
const E=require('../src/core'),L=require('../src/lesson'),root=path.resolve(__dirname,'..');
const reports=[];
for(const [bank,file] of [['nominal','example.json'],['disturbance-trained','example_robust.json']]){
 const all=JSON.parse(fs.readFileSync(path.join(root,'src',file)));
 const record=all.records.at(-1),rows=[];
 for(const [key,profile,pulse] of [['nominal','nominal',0],['mixed','mixed',0],['pulse12','nominal',12],['ood','ood',0]]){
  const trials=[];
  for(let i=0;i<12;i++){
   const {trace,...trial}=L.probe(record.policy,profile,818181+i*193,150,pulse,10,[.8,-.8,0][i%3]);
   trials.push(trial);
  }
  rows.push({key,passed:trials.filter(x=>x.success).length,modelInvalid:trials.filter(x=>x.outcome==='model_invalid').length,pulseReached:trials.filter(x=>x.pulseReached).length,pulseCompleted:trials.filter(x=>x.pulseCompleted).length,mean:E.avg(trials.map(x=>x.steps)),trials});
 }
 reports.push({bank,iteration:record.iter,seed:123,profile:record.hp.profile,plan:record.hp.plan,collectionSteps:record.envSteps,nominalEvaluation:record.evaluation.scores,rows});
 console.log(bank,record.iter,rows.map(x=>[x.key,x.passed,x.modelInvalid,x.pulseCompleted]));
}
fs.writeFileSync(path.join(root,'evidence','example_trials.json'),JSON.stringify({runtime:process.version,modelVersion:'planar-bam/2',selection:'Fixed 240th iteration; no best-checkpoint selection',reports},null,2));
