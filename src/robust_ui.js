'use strict';
// Progressive-disclosure UI for the independent Robust PPO v2 learner.
// It never creates another animated CartPole and never mutates the legacy learner.
const RV2={worker:null,ready:false,busy:false,running:false,until:0,latest:null,phase:'idle',error:null,envelope:null,envelopeOptions:null,seed:24680};
let RV2_DOWNLOAD=null;
function robustSpawn(){
 if(RV2.worker)return;
 try{
  const source=$('engine').textContent+'\n'+ROBUST_WORKER_SOURCE,url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));RV2.worker=new Worker(url);URL.revokeObjectURL(url);
  RV2.worker.onmessage=({data:m})=>{
   if(m.type==='ready'||m.type==='restored'){RV2.ready=true;RV2.busy=false;RV2.latest=m.record;RV2.phase='idle';}
   else if(m.type==='phase'){RV2.busy=true;RV2.phase=m.phase;}
   else if(m.type==='result'){RV2.busy=false;RV2.phase='idle';RV2.latest=m.record;if(RV2.running&&m.record.iter<RV2.until)setTimeout(robustIterate,0);else RV2.running=false;}
   else if(m.type==='envelope'){RV2.busy=false;RV2.phase='idle';RV2.envelope=m.rows;RV2.envelopeOptions=m.options;}
   else if(m.type==='checkpoint'){RV2_DOWNLOAD=m.data;saveJSON(m.data,`cartpole-robust-v2-I${m.data.iter}.json`);}
   else if(m.type==='error'){RV2.busy=false;RV2.running=false;RV2.error=m.message;}
   renderRobustState();
  };
  RV2.worker.onerror=e=>{RV2.ready=false;RV2.busy=false;RV2.running=false;RV2.error=e.message;renderRobustState();};
  RV2.worker.postMessage({type:'init',seed:RV2.seed,hp:{plant:{...P.DEFAULT_SPEC}}});
 }catch(e){RV2.error=e.message;renderRobustState();}
}
function robustIterate(){if(!RV2.ready||RV2.busy)return;RV2.busy=true;RV2.phase='collect';RV2.worker.postMessage({type:'iterate'});renderRobustState();}
function robustTrain20(){if(!RV2.ready||RV2.busy)return;RV2.running=true;RV2.until=(RV2.latest?.iter||0)+20;robustIterate();}
function robustStop(){RV2.running=false;renderRobustState();}
function robustEvaluate(options=null){if(!RV2.worker)robustSpawn();if(!RV2.ready||RV2.busy)return false;RV2.busy=true;RV2.phase='envelope';RV2.envelope=null;RV2.worker.postMessage({type:'envelope',options:options||{ratios:[0,.10,.20,.35,.50,.65,.80,1,1.25],durations:[.05,.10,.20,.40],trials:8,seed:930000}});renderRobustState();return true;}
function robustBoundaryNewton(){const p=RV2.latest?.policy?.plant||P.DEFAULT_SPEC,b=RV2.latest?.boundary?.levels?.[RV2.latest?.boundary?.index||0]??.1,params=P.sample(p,'nominal',0,new RNG(1));return {boundary:b,tip:RobustV2.tipForceForAuthority(p,params,b)};}
function robustGateText(){const g=RV2.latest?.gate;if(!g)return tr('robust.gate.none');return tr('robust.gate.value',g.nominal,g.tip,g.mixed,g.event||'hold');}
function robustEnvelopeHTML(){if(!RV2.envelope)return `<p class="inline-note">${tr('robust.envelope.none')}</p>`;const ratios=[...new Set(RV2.envelope.map(x=>x.ratio))].sort((a,b)=>a-b),durations=[...new Set(RV2.envelope.map(x=>x.duration))].sort((a,b)=>a-b),cell=(d,r)=>RV2.envelope.find(x=>x.duration===d&&x.ratio===r);return `<table class="robust-envelope"><thead><tr><th>${tr('robust.duration')}</th>${ratios.map(r=>`<th class="${r>1?'stress':''}">${Math.round(r*100)}%${r>1?`<small>${tr('robust.ood')}</small>`:''}</th>`).join('')}</tr></thead><tbody>${durations.map(d=>`<tr><th>${F(d,2)} s</th>${ratios.map(r=>{const x=cell(d,r),good=r<=1&&x.successes/x.trials>=.75;return `<td class="${r>1?'stress':good?'good':''}"><b>${x.successes}/${x.trials}</b><small>${tr('robust.invalid',x.modelInvalid)}</small></td>`;}).join('')}</tr>`).join('')}</tbody></table><p class="inline-note">${tr('robust.envelope.note')}</p>`;}
function renderRobustState(){
 const root=$('robustV2');if(!root)return;const n=robustBoundaryNewton();
 const method=$('robustMethod');if(method)method.textContent=tr('robust.method');
 const boundary=$('robustBoundary');if(boundary)boundary.textContent=tr('robust.boundary',Math.round(n.boundary*100),F(n.tip,3));
 const gate=$('robustGate');if(gate)gate.textContent=robustGateText();
 const status=$('robustStatus');if(status)status.textContent=RV2.error?tr('robust.error',RV2.error):tr('robust.status',RV2.latest?.iter||0,RV2.phase,RV2.latest?.transitions||0);
 const one=$('robustOneIteration'),train=$('robustTrain20'),stop=$('robustStop'),env=$('robustEnvelope');if(one)one.disabled=!RV2.ready||RV2.busy||RV2.running;if(train)train.disabled=!RV2.ready||RV2.busy||RV2.running;if(stop)stop.disabled=!RV2.running;if(env)env.disabled=!RV2.ready||RV2.busy;
 const table=$('robustEnvelopeTable');if(table)table.innerHTML=robustEnvelopeHTML();
}
function mountRobustPanel(){
 if(S.chapter!==5||!$('lessonBody')||$('robustV2'))return;
 $('lessonBody').insertAdjacentHTML('beforeend',`<details id="robustV2" class="robust-v2"><summary>${tr('robust.title')}<span>${tr('robust.summary')}</span></summary><div class="robust-inner"><div class="robust-method"><b id="robustMethod"></b><small>${tr('robust.method.sub')}</small></div><div class="robust-kpis"><div><small>${tr('robust.boundary.label')}</small><b id="robustBoundary">—</b></div><div><small>${tr('robust.gate.label')}</small><b id="robustGate">—</b></div><div><small>${tr('robust.state.label')}</small><b id="robustStatus">—</b></div></div><div class="robust-actions"><button id="robustOneIteration">${tr('robust.one')}</button><button id="robustTrain20">${tr('robust.train20')}</button><button id="robustStop">${tr('robust.stop')}</button><button id="robustEnvelope">${tr('robust.evaluate')}</button><button id="robustSave">${tr('robust.save')}</button><label class="outline robust-load">${tr('robust.load')}<input id="robustLoad" type="file" accept="application/json,.json" hidden></label></div><p class="inline-note">${tr('robust.distribution')}</p><div id="robustEnvelopeTable"></div></div></details>`);
 const root=$('robustV2');root.addEventListener('toggle',()=>{if(root.open)robustSpawn();renderRobustState();});
 $('robustOneIteration').onclick=robustIterate;$('robustTrain20').onclick=robustTrain20;$('robustStop').onclick=robustStop;$('robustEnvelope').onclick=()=>robustEvaluate();$('robustSave').onclick=()=>{if(RV2.ready&&!RV2.busy)RV2.worker.postMessage({type:'checkpoint'});};
 $('robustLoad').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5e6)throw Error('checkpoint too large');const data=JSON.parse(await file.text());RV2.worker.postMessage({type:'restore',data});}catch(err){RV2.error=err.message;renderRobustState();}e.target.value='';};
 renderRobustState();
}
const _renderExperimentRobustV2=renderExperiment;
renderExperiment=function(){_renderExperimentRobustV2();mountRobustPanel();};
window.RobustUI=Object.freeze({status:()=>({ready:RV2.ready,busy:RV2.busy,running:RV2.running,latestIteration:RV2.latest?.iter||0,boundary:robustBoundaryNewton().boundary,transitions:RV2.latest?.transitions||0,actorAdam:RV2.latest?.policy?.actor?.t||0,criticAdam:RV2.latest?.policy?.critic?.t||0,gate:copy(RV2.latest?.gate||null),envelope:copy(RV2.envelope),phase:RV2.phase,error:RV2.error}),evaluateEnvelope:(options)=>robustEvaluate(options)});
