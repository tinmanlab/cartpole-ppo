'use strict';
let robustTrainer=null,robustBusy=false;
const robustYield=()=>new Promise(r=>setTimeout(r,0));
function robustRecord(before,run,duration){return {iter:robustTrainer.iter,policy:robustTrainer.snapshot(),before,stats:robustTrainer.last,gate:robustTrainer.gateResult,transitions:run?.data?.length||0,trace:run?.trace||[],envSteps:robustTrainer.steps,episodes:robustTrainer.episodes,trainMean:robustTrainer.scores.length?avg(robustTrainer.scores):null,duration,boundary:robustTrainer.boundary.snapshot(),hp:robustTrainer.hp};}
self.onmessage=async({data:m})=>{try{
 if(m.type==='init'){
  if(robustBusy)throw Error('Robust learner is busy.');
  robustTrainer=new RobustV2.Trainer(m.seed??24680,m.hp||{});
  self.postMessage({type:'ready',record:robustRecord(robustTrainer.snapshot(),null,0)});return;
 }
 if(!robustTrainer)throw Error('Initialize Robust PPO v2 first.');
 if(m.type==='iterate'){
  if(robustBusy)throw Error('Robust learner is already updating.');robustBusy=true;
  const before=robustTrainer.snapshot(),start=performance.now();
  self.postMessage({type:'phase',phase:'collect',iteration:robustTrainer.iter+1,total:robustTrainer.hp.n*robustTrainer.hp.horizon});await robustYield();
  const run=robustTrainer.collect();
  self.postMessage({type:'phase',phase:'optimize',iteration:robustTrainer.iter+1,total:robustTrainer.hp.epochs*Math.ceil(run.data.length/robustTrainer.hp.batch)});await robustYield();
  robustTrainer.optimize(run.data);
  if(robustTrainer.iter%robustTrainer.hp.gateEvery===0){self.postMessage({type:'phase',phase:'gate',iteration:robustTrainer.iter});await robustYield();robustTrainer.gateResult=robustTrainer.gate();}
  const record=robustRecord(before,run,performance.now()-start);robustBusy=false;self.postMessage({type:'result',record});return;
 }
 if(m.type==='envelope'){
  if(robustBusy)throw Error('Wait for the robust update to finish.');robustBusy=true;self.postMessage({type:'phase',phase:'envelope'});await robustYield();
  const rows=RobustV2.evaluateEnvelope(robustTrainer.snapshot(),m.options||{});robustBusy=false;self.postMessage({type:'envelope',rows,options:m.options||{}});return;
 }
 if(m.type==='checkpoint'){
  if(robustBusy)throw Error('Save at a robust iteration boundary.');self.postMessage({type:'checkpoint',data:robustTrainer.checkpoint()});return;
 }
 if(m.type==='restore'){
  if(robustBusy)throw Error('Stop robust training before restoring.');const candidate=RobustV2.restoreTrainer(m.data);robustTrainer=candidate;self.postMessage({type:'restored',record:robustRecord(robustTrainer.snapshot(),null,0)});return;
 }
}catch(error){robustBusy=false;self.postMessage({type:'error',message:error.message});}};
