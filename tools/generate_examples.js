'use strict';
const fs=require('fs'),path=require('path'),ROOT=path.resolve(__dirname,'..'),E=require('../src/core'),P=require('../src/plant');
const kind=process.argv[2]||'nominal',t=new E.Trainer(123,{plant:P.DEFAULT_SPEC,profile:kind==='robust'?'mixed':'nominal',plan:kind==='robust'?'ramp':'fixed'}),records=[];
const rec=(b,rollout,e,duration)=>JSON.parse(JSON.stringify({iter:t.iter,policy:t.snapshot(),before:b,evaluation:e,rollout,stats:t.last,detail:t.detail||null,updates:t.updates||[],trainMean:E.avg(t.scores),envSteps:t.steps,episodes:t.episodes,duration,hp:t.hp,exposure:t.exposure,trainingProfile:t.collectionProfile,trainingLevel:t.collectionLevel,curriculum:t.curriculum}));
records.push(rec(t.snapshot(),[],t.evaluate(),0));const checkpoints=new Set([1,10,30,60,120,240]);
for(let k=1;k<=240;k++){const before=t.snapshot(),now=Date.now(),r=t.iteration();if(checkpoints.has(k)){for(const f of r.trace){const q=r.data[f.index];Object.assign(f,{adv:q.adv,rawAdv:q.rawAdv,delta:q.delta,oldV:q.oldV,nextV:q.nextV,ret:q.ret});delete f.index;}const ev=t.evaluate();records.push(rec(before,r.trace,ev,Date.now()-now));console.log(kind,k,ev.mean,ev.reached);}}
fs.writeFileSync(ROOT+'/src/'+(kind==='robust'?'example_robust.json':'example.json'),JSON.stringify({schema:'bam-record-example/v1',note:'Recorded learning with planar-bam/2. Nominal fixed evaluation is not an OOD result.',records}));
fs.writeFileSync(ROOT+'/examples/'+kind+'_bam_checkpoint.json',JSON.stringify(E.trainerCheckpoint(t)));
