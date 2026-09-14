'use strict';
let trainer=null,busy=false;const yieldWorker=()=>new Promise(r=>setTimeout(r,0));
function record(before,trace,evaluation,duration){return {iter:trainer.iter,policy:trainer.snapshot(),before,evaluation,rollout:trace,stats:trainer.last,detail:trainer.detail||null,updates:trainer.updates||[],trainMean:trainer.scores.length?avg(trainer.scores):null,envSteps:trainer.steps,episodes:trainer.episodes,duration,hp:trainer.hp,trainingProfile:trainer.collectionProfile,trainingLevel:trainer.collectionLevel,curriculum:trainer.curriculum,stageGate:trainer.stageGate||null,exposure:{...trainer.exposure}};}
self.onmessage=async({data:m})=>{try{
 if(m.type==='init'){trainer=new Trainer(m.seed,m.hp);self.postMessage({type:'ready',record:record(trainer.snapshot(),[],trainer.evaluate(),0)});return;}
 if(m.type==='continue'){if(busy)throw Error('Wait for the current iteration to finish before changing conditions.');trainer.continueConditions(m.plant,m.profile,m.plan);self.postMessage({type:'continued',hp:trainer.hp,curriculum:trainer.curriculum});return;}
 if(m.type==='checkpoint'){if(busy)throw new Error('Save at an iteration boundary.');self.postMessage({type:'checkpoint',data:trainerCheckpoint(trainer)});return;}
 if(m.type==='restore'){if(busy)throw new Error('Stop training before restoring a checkpoint.');try{const candidate=restoreTrainer(m.data);trainer=candidate;self.postMessage({type:'restored',record:record(trainer.snapshot(),[],trainer.evaluate(),0),seed:trainer.seed});}catch(error){self.postMessage({type:'notice',message:error.message});}return;}
 if(m.type==='evaluate'){
  const rows=[],conditions=[{key:'nominal',name:'Nominal',profile:'nominal',pulse:0},{key:'mixed',name:'Configured mixed disturbances',profile:'mixed',pulse:0},{key:'pulse12',name:'12 N × 0.20 s push',profile:'nominal',pulse:12},{key:'ood',name:'Mixed OOD (1.5×)',profile:'ood',pulse:0}];
  for(const condition of conditions){const trials=[];let first=null;for(let i=0;i<12;i++){const t=Lesson.probe({...m.policy,plant:m.testSpec||m.policy.plant},condition.profile,818181+i*193,150,condition.pulse,10,[.8,-.8,0][i%3]);if(i===0)first=t.trace;const {trace,...small}=t;trials.push(small);}rows.push({condition,...{trials,first},mean:avg(trials.map(t=>t.steps)),passed:trials.filter(t=>t.success).length,reachedPulse:trials.filter(t=>t.pulseReached).length,completedPulse:trials.filter(t=>t.pulseCompleted).length,invalid:trials.filter(t=>t.outcome==='model_invalid').length,failureCounts:trials.reduce((a,t)=>{const k=t.outcome||'unknown';a[k]=(a[k]||0)+1;return a;},{})});self.postMessage({type:'evaluationProgress',request:m.request,completed:rows.length,total:conditions.length});await yieldWorker();}
  self.postMessage({type:'evaluation',request:m.request,rows});return;
 }
 if(m.type!=='iterate'||!trainer||busy)return;busy=true;const before=trainer.snapshot(),start=performance.now(),it=trainer.collectChunks();let chunk;
 do{chunk=it.next();if(!chunk.done){self.postMessage({type:'phase',phase:'collect',...chunk.value,iteration:trainer.iter+1});await yieldWorker();}}while(!chunk.done);
 const {data,trace}=chunk.value;self.postMessage({type:'phase',phase:'gae',completed:0,total:data.length});await yieldWorker();computeGAE(data,trainer.hp.n,trainer.hp.gamma,trainer.hp.lambda);
 for(const f of trace){const q=data[f.index];Object.assign(f,{adv:q.adv,rawAdv:q.rawAdv,delta:q.delta,oldV:q.oldV,nextV:q.nextV,ret:q.ret});delete f.index;}
 let count=0;for(const progress of trainer.optimize(data)){if(++count%4===0){self.postMessage({type:'phase',phase:'optimize',...progress,completed:count,total:64});await yieldWorker();}}
 self.postMessage({type:'phase',phase:'evaluate',completed:0,total:12});await yieldWorker();const evaluation=trainer.evaluate();trainer.stageGate=trainer.assessCurriculum();self.postMessage({type:'result',record:record(before,trace,evaluation,performance.now()-start)});busy=false;
}catch(error){busy=false;self.postMessage({type:'error',message:error.message});}};
