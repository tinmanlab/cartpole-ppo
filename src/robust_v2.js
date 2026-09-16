'use strict';
// Robust PPO v2 is intentionally separate from the historical discrete Trainer.
// It reuses the exact CartPole/BAM physical path and adds continuous control,
// short observation/action history, an asymmetric training critic, authority-
// normalized disturbances, adaptive curriculum, and an explicit test envelope.
const RobustV2=(()=>{
 const E=typeof module!=='undefined'?require('./core'):null;
 const P=typeof module!=='undefined'?require('./plant'):Plant;
 const CP=typeof module!=='undefined'?E.CartPole:CartPole;
 const NN=typeof module!=='undefined'?E.MLP:MLP;
 const Random=typeof module!=='undefined'?E.RNG:RNG;
 const clamp=typeof module!=='undefined'?E.clip:clip;
 const mean=typeof module!=='undefined'?E.avg:avg;
 const gae=typeof module!=='undefined'?E.computeGAE:computeGAE;
 const CONTROL_DT=.02;
 const LOG_2PI=Math.log(2*Math.PI);
 const HISTORY_STEPS=5;
 const BOUNDARIES=[.10,.20,.35,.50,.65,.80];
 const MIXTURE={nominal:.30,tipImpulse:.25,tipHold:.10,bodyImpulse:.15,mixed:.20};
 const DEFAULT_HP={gamma:.99,lambda:.95,epsilon:.2,actorLR:.0003,criticLR:.001,entropy:.002,epochs:4,batch:128,n:16,horizon:128,history:HISTORY_STEPS,plant:{...P.DEFAULT_SPEC},gateEvery:5,domainRandomizationProb:.50};

 // Reuse-first adapter: the legacy step is the sole physical implementation.
 // Scaling spec.force for this synchronous call produces an exact continuous
 // command while finally restoring the immutable experiment configuration.
 if(!CP.prototype.stepContinuous){
  CP.prototype.stepContinuous=function(action,externalForce=0,tipForce=0){
   if(!Number.isFinite(action)||action < -1 || action > 1)throw Error('Continuous action must be in [-1,1].');
   const base=this.spec.force,mag=Math.abs(action)*base;
   this.spec.force=mag;
   try{return this.step(action>=0?1:0,externalForce,tipForce);}
   finally{this.spec.force=base;}
  };
 }

 const finite=x=>Number.isFinite(x);
 const clone=x=>JSON.parse(JSON.stringify(x));
 function rngState(r){return {s:r.s,spare:r.spare};}
 function restoreRng(s){if(!s||!Number.isInteger(s.s)||s.s<0||s.s>4294967295||(s.spare!==null&&!finite(s.spare)))throw Error('Invalid robust RNG state.');const r=new Random(s.s);r.spare=s.spare;return r;}
 function atanh(x){x=clamp(x,-1+1e-8,1-1e-8);return .5*Math.log((1+x)/(1-x));}

 class HistoryBuffer{
  constructor(obs,steps=HISTORY_STEPS){if(!Array.isArray(obs)||obs.length!==5||!obs.every(finite)||!Number.isInteger(steps)||steps<1)throw Error('Invalid history seed.');this.steps=steps;this.frames=Array.from({length:steps},()=>[...obs,0]);}
  input(){return this.frames.flat();}
  append(obs,action){if(!Array.isArray(obs)||obs.length!==5||!obs.every(finite)||!finite(action))throw Error('Invalid history append.');this.frames.shift();this.frames.push([...obs,action]);}
  snapshot(){return {steps:this.steps,frames:this.frames.map(x=>x.slice())};}
  static from(s){if(!s||!Number.isInteger(s.steps)||!Array.isArray(s.frames)||s.frames.length!==s.steps||s.frames.some(x=>!Array.isArray(x)||x.length!==6||!x.every(finite)))throw Error('Invalid robust history checkpoint.');const h=Object.create(HistoryBuffer.prototype);h.steps=s.steps;h.frames=s.frames.map(x=>x.slice());return h;}
 }

 function gaussianTerms(mu,rawLogStd,z){
  if(![mu,rawLogStd,z].every(finite))throw Error('Invalid Gaussian policy terms.');
  const logStd=clamp(rawLogStd,-3,.5),sigma=Math.exp(logStd),action=Math.tanh(z),jac=Math.log(Math.max(1e-8,1-action*action));
  const q=(z-mu)/sigma,logp=-.5*q*q-logStd-.5*LOG_2PI-jac,entropy=.5*(1+LOG_2PI)+logStd;
  return {mu,rawLogStd,logStd,sigma,z,action,logp,entropy,clampGradient:rawLogStd>=-3&&rawLogStd<=.5?1:0};
 }
 function gaussianPpoLoss(mu,rawLogStd,z,oldLogp,adv,epsilon=.2,entropyCoef=.002){
  const t=gaussianTerms(mu,rawLogStd,z),ratio=Math.exp(t.logp-oldLogp),clipped=clamp(ratio,1-epsilon,1+epsilon),objective=Math.min(ratio*adv,clipped*adv);
  return {...t,ratio,clipped,active:adv>=0?ratio<=1+epsilon:ratio>=1-epsilon,objective,loss:-objective-entropyCoef*t.entropy};
 }
 function gaussianPpoDerivatives(mu,rawLogStd,z,oldLogp,adv,epsilon=.2,entropyCoef=.002){
  const t=gaussianPpoLoss(mu,rawLogStd,z,oldLogp,adv,epsilon,entropyCoef),dLogP=t.active?-adv*t.ratio:0,dMuLog=(z-mu)/(t.sigma*t.sigma),dStdLog=((z-mu)*(z-mu)/(t.sigma*t.sigma)-1)*t.clampGradient;
  return {...t,dMu:dLogP*dMuLog,dLogStd:dLogP*dStdLog-entropyCoef*t.clampGradient};
 }
 function gaussianPolicy(model,input,deterministic=true,rng=null){
  const f=model.forward(input),mu=f.y[0],rawLogStd=f.y[1],logStd=clamp(rawLogStd,-3,.5),sigma=Math.exp(logStd),z=deterministic?mu:mu+sigma*rng.normal(),t=gaussianTerms(mu,rawLogStd,z);
  return {...t,f};
 }

 function reflectedMass(spec){if(spec.actuator==='ideal')return 0;const a=P.ACTUATORS[spec.actuator],n=2,r=P.WHEEL.radius,rg=r*spec.ratio;return n*P.WHEEL.inertia/(r*r)+n*a.armature/(rg*rg);}
 function availableWheelForce(spec,params={gain:1}){
  spec=P.validateSpec(spec);const gain=finite(params.gain)?params.gain:1,command=spec.force*gain;
  if(spec.actuator==='ideal')return Math.abs(command);
  const a=P.ACTUATORS[spec.actuator],n=2,rg=P.WHEEL.radius*spec.ratio,requested=command*rg/n*a.R/a.kt,limit=a.vin*a.maxPWM,voltage=clamp(requested,-limit,limit),motor=P.motorTorque(a,voltage,0),fr=P.frictionM6(a,motor,0,0).frictionloss;
  return Math.max(1e-9,n*Math.max(0,Math.abs(motor)-fr)/rg);
 }
 function tipDriveCoefficient(spec,params){const mp=Math.max(1e-9,params.mp),mass=params.mc+params.mp+reflectedMass(spec);return Math.max(1e-9,2*mass/mp-1);}
 function tipAuthorityRatio(spec,params,tipForce){if(!finite(tipForce))throw Error('Invalid tip force.');if(tipForce===0)return 0;return Math.abs(tipDriveCoefficient(spec,params)*tipForce)/availableWheelForce(spec,params);}
 function tipForceForAuthority(spec,params,ratio){if(!finite(ratio)||ratio<0)throw Error('Invalid authority ratio.');return ratio*availableWheelForce(spec,params)/tipDriveCoefficient(spec,params);}

 function privilegedInput(env,actorInput,cartForce=0,tipForce=0){
  if(!Array.isArray(actorInput)||actorInput.length!==30||!actorInput.every(finite))throw Error('Robust actor history must contain 30 finite values.');
  const s=env.spec,p=env.params,den=x=>Math.max(1e-9,Math.abs(x)),available=availableWheelForce(s,p),tipOne=Math.max(1e-9,tipForceForAuthority(s,p,1));
  const suffix=[env.s[0]/2.4,env.s[1]/2.5,env.s[2]/(Math.PI/15),env.s[3]/2.5,env.goal/2.4,p.mc/den(s.mc),p.mp/den(s.mp),p.l/den(s.l),p.gain,p.tau/Math.max(CONTROL_DT,s.lag||CONTROL_DT),p.delay*CONTROL_DT/Math.max(CONTROL_DT,s.delay||CONTROL_DT),p.friction/Math.max(.01,s.friction||.01),cartForce/available,tipForce/tipOne];
  const out=actorInput.concat(suffix);if(out.length!==44||!out.every(finite))throw Error('Invalid privileged critic input.');return out;
 }

 function sampleFamily(rng){const u=rng.uniform();if(u<MIXTURE.nominal)return'nominal';if(u<MIXTURE.nominal+MIXTURE.tipImpulse)return'tipImpulse';if(u<MIXTURE.nominal+MIXTURE.tipImpulse+MIXTURE.tipHold)return'tipHold';if(u<MIXTURE.nominal+MIXTURE.tipImpulse+MIXTURE.tipHold+MIXTURE.bodyImpulse)return'bodyImpulse';return'mixed';}
 function makeEvent(kind,force,start,duration){return {kind,force,start,end:start+duration,duration};}
 function makeEpisodeSchedule(rng,spec,params,boundary,family){
  const events=[],u=()=>rng.uniform(),sign=()=>u()<.5?-1:1,first=.30+.60*u(),available=availableWheelForce(spec,params);
  const tipImpulse=()=>{const ratio=boundary*(.35+.65*u()),duration=.05+.15*u();return makeEvent('tip',sign()*tipForceForAuthority(spec,params,ratio),first,duration);};
  const tipHold=()=>{const ratio=boundary*(.15+.25*u()),duration=.30+.50*u();return makeEvent('tip',sign()*tipForceForAuthority(spec,params,ratio),first,duration);};
  const body=()=>makeEvent('cart',sign()*available*boundary*(.20+.50*u()),first,.05+.20*u());
  if(family==='tipImpulse')events.push(tipImpulse());
  else if(family==='tipHold')events.push(tipHold());
  else if(family==='bodyImpulse')events.push(body());
  else if(family==='mixed')events.push(u()<.55?tipImpulse():body());
  if(events.length&&u()<.45){const e=events[0],start=e.end+1.5+1.5*u();if(start<8.5){const second=family==='tipHold'?tipHold():u()<.55?tipImpulse():body();second.start=start;second.end=start+second.duration;events.push(second);}}
  return {family,boundary,events};
 }
 function sampleEpisodeDisturbance(rng,spec,params,boundary){return makeEpisodeSchedule(rng,spec,params,boundary,sampleFamily(rng));}
 function forcesAt(schedule,time){let cart=0,tip=0;for(const e of schedule.events)if(time>=e.start&&time<e.end){if(e.kind==='tip')tip+=e.force;else cart+=e.force;}return {cart,tip};}

 class AdaptiveBoundary{
  constructor(state=null){if(state){Object.assign(this,clone(state));return;}this.levels=BOUNDARIES.slice();this.index=0;this.streak=0;this.history=[];this.last=null;}
  get value(){return this.levels[this.index];}
  grade(result){const {nominal,tip,mixed,count}=result;if(![nominal,tip,mixed,count].every(Number.isInteger)||count<=0)throw Error('Invalid robust curriculum gate.');let event='hold';
   if(this.index>0&&(tip<4||mixed<4)){this.index--;this.streak=0;event='contract';}
   else if(nominal>=7&&tip>=6&&mixed>=6){this.streak++;if(this.streak>=2&&this.index<this.levels.length-1){this.index++;this.streak=0;event='promote';}}
   else this.streak=0;
   this.last={...result,event,boundary:this.value};this.history.push(this.last);if(this.history.length>100)this.history.shift();return this.last;
  }
  snapshot(){return {levels:this.levels.slice(),index:this.index,streak:this.streak,history:clone(this.history),last:clone(this.last)};}
 }

 function robustReward(out,action,previous){return out.reward-.002*action*action-.01*(action-previous)*(action-previous)-(out.terminated?5:0);}
 function shuffle(ids,rng){for(let i=ids.length-1;i>0;i--){const j=Math.floor(rng.uniform()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}}

 class Trainer{
  constructor(seed=123,hp={}){
   this.seed=seed>>>0;this.rng=new Random(this.seed);this.hp={...DEFAULT_HP,...hp,plant:P.validateSpec(hp.plant||DEFAULT_HP.plant)};this.hp.history=HISTORY_STEPS;
   if(!finite(this.hp.domainRandomizationProb)||this.hp.domainRandomizationProb<0||this.hp.domainRandomizationProb>1)throw Error('domainRandomizationProb must be in [0,1].');
   this.actor=new NN(this.rng,30,32,2,.02);this.critic=new NN(this.rng,44,64,1,.1);this.initial=Array.from(this.actor.p);this.boundary=new AdaptiveBoundary();this.iter=0;this.steps=0;this.episodes=0;this.scores=[];this.last={actorGrad:0,criticGrad:0,entropy:0,clipFraction:0,piLoss:0,valueLoss:0,delta:0,adamSteps:0};this.gateResult=null;
   this.slots=Array.from({length:this.hp.n},(_,i)=>this._makeSlot(i));
  }
  _makeSlot(i){const env=new CP(new Random((this.seed+1009+i*7919)>>>0),{spec:this.hp.plant,profile:'nominal',seed:(this.seed+700001+i*3571)>>>0}),slot={env,history:null,schedule:null,prevAction:0,family:'nominal',domainRandomized:false};this._resetSlot(slot);return slot;}
  _resetSlot(slot,family=null){
   family=family||sampleFamily(this.rng);slot.family=family;
   const factorized=family!=='nominal'&&family!=='mixed'&&this.hp.domainRandomizationProb>0&&this.rng.uniform()<this.hp.domainRandomizationProb,randomized=family==='mixed'||factorized;
   slot.domainRandomized=randomized;slot.env.configure(randomized?'mixed':'nominal',randomized?this.boundary.value:0);slot.env.reset(2*this.rng.uniform()-1);if(randomized)slot.env.params.pushAmp=0;
   slot.schedule=makeEpisodeSchedule(this.rng,slot.env.spec,slot.env.params,this.boundary.value,family);slot.prevAction=0;slot.history=new HistoryBuffer(slot.env.obs(),HISTORY_STEPS);
  }
  collect(){
   const data=[],trace=[];
   for(let t=0;t<this.hp.horizon;t++)for(let i=0;i<this.slots.length;i++){
    const slot=this.slots[i],env=slot.env,time=env.steps*CONTROL_DT,force=forcesAt(slot.schedule,time),actorInput=slot.history.input(),ac=gaussianPolicy(this.actor,actorInput,false,this.rng),criticInput=privilegedInput(env,actorInput,force.cart,force.tip),oldV=this.critic.forward(criticInput).y[0],s=env.s.slice(),goal=env.goal,step=env.steps;
    const out=env.stepContinuous(ac.action,force.cart,force.tip),reward=robustReward(out,ac.action,slot.prevAction);slot.history.append(env.obs(),ac.action);const nextActor=slot.history.input(),nextForce=forcesAt(slot.schedule,env.steps*CONTROL_DT),nextCritic=privilegedInput(env,nextActor,nextForce.cart,nextForce.tip),nextV=this.critic.forward(nextCritic).y[0];
    const q={env:i,actorInput,criticInput,action:ac.action,z:ac.z,oldLogp:ac.logp,oldV,r:reward,terminated:out.terminated,done:out.done,nextV,s,ns:env.s.slice(),goal,cartForce:force.cart,tipForce:force.tip,family:slot.family,domainRandomized:slot.domainRandomized,drive:out.drive};data.push(q);
    if(i===0)trace.push({s,ns:env.s.slice(),goal,step,action:ac.action,mu:ac.mu,logStd:ac.logStd,value:oldV,reward,done:out.done,terminated:out.terminated,cartForce:force.cart,tipForce:force.tip,drive:out.drive,family:slot.family,domainRandomized:slot.domainRandomized});
    slot.prevAction=ac.action;this.steps++;
    if(out.done){this.episodes++;this.scores.push(env.steps);if(this.scores.length>100)this.scores.shift();this._resetSlot(slot);}
   }
   return {data,trace};
  }
  optimize(data){
   gae(data,this.hp.n,this.hp.gamma,this.hp.lambda);const ids=Array.from({length:data.length},(_,i)=>i);let count=0,pi=0,vl=0,ent=0,cf=0,ga=0,gc=0;
   for(let ep=0;ep<this.hp.epochs;ep++){shuffle(ids,this.rng);for(let st=0;st<ids.length;st+=this.hp.batch){const end=Math.min(ids.length,st+this.hp.batch),size=end-st,GA=new Float64Array(this.actor.p.length),GC=new Float64Array(this.critic.p.length);
    for(let k=st;k<end;k++){const q=data[ids[k]],fa=this.actor.forward(q.actorInput),d=gaussianPpoDerivatives(fa.y[0],fa.y[1],q.z,q.oldLogp,q.adv,this.hp.epsilon,this.hp.entropy);this.actor.backward(fa,[d.dMu,d.dLogStd],GA,1/size);const fc=this.critic.forward(q.criticInput),dv=fc.y[0]-q.ret;this.critic.backward(fc,[dv],GC,1/size);pi+=d.loss;vl+=.5*dv*dv;ent+=d.entropy;cf+=!d.active;count++;}
    ga=this.actor.adam(GA,this.hp.actorLR).norm;gc=this.critic.adam(GC,this.hp.criticLR).norm;
   }}
   this.iter++;const delta=Math.sqrt(this.actor.p.reduce((s,v,i)=>s+(v-this.initial[i])**2,0));this.last={actorGrad:ga,criticGrad:gc,entropy:ent/count,clipFraction:cf/count,piLoss:pi/count,valueLoss:vl/count,delta,adamSteps:this.actor.t};return this.last;
  }
  iteration(){const rec=this.collect();this.optimize(rec.data);if(this.iter%this.hp.gateEvery===0)this.gateResult=this.gate();return rec;}
  gate(){const base=(this.seed+900000+this.iter*1009)>>>0,nom=evaluateGateFamily(this.snapshot(),'nominal',this.boundary.value,8,base),tip=evaluateGateFamily(this.snapshot(),'tip',this.boundary.value,8,base+10000),mix=evaluateGateFamily(this.snapshot(),'mixed',this.boundary.value,8,base+20000),grade=this.boundary.grade({nominal:nom,tip,mixed:mix,count:8});return {...grade,nominal:nom,tip,mixed:mix};}
  snapshot(){return {schema:'cartpole-robust-v2-policy/v1',method:'robust-v2',iter:this.iter,plant:clone(this.hp.plant),hp:clone(this.hp),boundary:this.boundary.snapshot(),actor:this.actor.snapshot(),critic:this.critic.snapshot()};}
  checkpoint(){return {schema:'cartpole-robust-v2-checkpoint/v1',seed:this.seed,hp:clone(this.hp),iter:this.iter,steps:this.steps,episodes:this.episodes,scores:this.scores.slice(),initial:this.initial.slice(),last:clone(this.last),gateResult:clone(this.gateResult),rng:rngState(this.rng),boundary:this.boundary.snapshot(),actor:this.actor.optimizerSnapshot(),critic:this.critic.optimizerSnapshot(),slots:this.slots.map(s=>{const {rng,noiseRng,...env}=s.env;return {env:clone(env),rng:rngState(rng),noiseRng:rngState(noiseRng),history:s.history.snapshot(),schedule:clone(s.schedule),prevAction:s.prevAction,family:s.family,domainRandomized:s.domainRandomized};})};}
 }

 function restoreTrainer(cp){
  if(cp?.schema!=='cartpole-robust-v2-checkpoint/v1')throw Error('Robust PPO v2 requires its own v1 checkpoint.');const hp=clone(cp.hp);if(!Object.hasOwn(hp,'domainRandomizationProb'))hp.domainRandomizationProb=0;const t=new Trainer(cp.seed,hp);t.iter=cp.iter;t.steps=cp.steps;t.episodes=cp.episodes;t.scores=cp.scores.slice();t.initial=cp.initial.slice();t.last=clone(cp.last);t.gateResult=clone(cp.gateResult);t.rng=restoreRng(cp.rng);t.boundary=new AdaptiveBoundary(cp.boundary);t.actor=NN.from(cp.actor);t.critic=NN.from(cp.critic);
  if(!Array.isArray(cp.slots)||cp.slots.length!==t.hp.n)throw Error('Invalid robust slot checkpoint.');t.slots=cp.slots.map(s=>{const env=Object.create(CP.prototype);Object.assign(env,clone(s.env));env.rng=restoreRng(s.rng);env.noiseRng=restoreRng(s.noiseRng);return {env,history:HistoryBuffer.from(s.history),schedule:clone(s.schedule),prevAction:s.prevAction,family:s.family,domainRandomized:s.domainRandomized??s.env.profile==='mixed'};});return t;
 }

 function rollout(snapshot,options={}){
  const ratio=options.ratio??0,duration=options.duration??.1,seed=options.seed??810000,goal=options.goal??.8,mixed=!!options.mixed,actor=NN.from(snapshot.actor),env=new CP(new Random(seed),{spec:snapshot.plant,profile:mixed?'mixed':'nominal',level:mixed?Math.min(1,ratio||.5):0,seed:(seed+700001)>>>0});env.reset(goal);if(mixed)env.params.pushAmp=0;const history=new HistoryBuffer(env.obs(),HISTORY_STEPS),tipAmp=tipForceForAuthority(env.spec,env.params,ratio),sign=options.sign??1,start=options.start??1,tail=[],trace=[];let maxAngle=0,maxError=0,sat=0,steps=0,recoveryTime=null,dwell=0,prev=0;
  while(!env.done){const time=env.steps*CONTROL_DT,tip=time>=start&&time<start+duration?sign*tipAmp:0,ai=history.input(),ac=gaussianPolicy(actor,ai,true,null),s=env.s.slice(),out=env.stepContinuous(ac.action,0,tip);history.append(env.obs(),ac.action);prev=ac.action;steps++;maxAngle=Math.max(maxAngle,Math.abs(env.s[2]*180/Math.PI));maxError=Math.max(maxError,Math.abs(env.s[0]-goal));if(out.drive.saturated)sat++;if(env.steps>=350)tail.push(Math.abs(env.s[0]-goal));if(time>=start+duration){const safe=Math.abs(env.s[2])<3*Math.PI/180&&Math.abs(env.s[3])<.5&&Math.abs(env.s[0]-goal)<.25&&Math.abs(env.s[1])<.4;dwell=safe?dwell+1:0;if(recoveryTime===null&&dwell>=25)recoveryTime=(env.steps*CONTROL_DT)-(start+duration)-.5;}
   if(options.trace)trace.push({s,ns:env.s.slice(),goal,step:env.steps-1,action:ac.action,mu:ac.mu,logStd:ac.logStd,reward:out.reward,done:out.done,terminated:out.terminated,tipForce:tip,drive:out.drive});
  }
  const tailError=env.steps===500&&tail.length?mean(tail):null,success=!env.terminated&&env.steps===500&&tailError!==null&&tailError<.25;return {success,modelInvalid:!!env.validityLimit,steps:env.steps,tailError,maxAngle,maxError,recoveryTime,saturationFraction:steps?sat/steps:0,trace};
 }
 function evaluateGateFamily(snapshot,family,boundary,count,seed){let passed=0;for(let i=0;i<count;i++){const goal=[.8,-.8,0][i%3],sign=i%2?1:-1,opt={seed:seed+i*193,goal,sign};if(family==='tip')Object.assign(opt,{ratio:boundary,duration:.12});else if(family==='mixed')Object.assign(opt,{ratio:boundary*.6,duration:.12,mixed:true});const r=rollout(snapshot,opt);if(r.success)passed++;}return passed;}
 function evaluateEnvelope(snapshot,options={}){
  const ratios=options.ratios||[0,.10,.20,.35,.50,.65,.80,1,1.25],durations=options.durations||[.05,.10,.20,.40],trials=options.trials||8,seed=options.seed??930000,rows=[];
  for(const duration of durations)for(const ratio of ratios){let successes=0,modelInvalid=0,maxAngle=0,maxError=0,sat=0,recovery=[];for(let i=0;i<trials;i++){const r=rollout(snapshot,{ratio,duration,seed:seed+rows.length*10007+i*193,goal:[.8,-.8,0][i%3],sign:i%2?1:-1});if(r.success)successes++;if(r.modelInvalid)modelInvalid++;maxAngle=Math.max(maxAngle,r.maxAngle);maxError=Math.max(maxError,r.maxError);sat+=r.saturationFraction;if(r.recoveryTime!==null)recovery.push(r.recoveryTime);}rows.push({ratio,duration,trials,successes,modelInvalid,maxAngle,maxError,recoveryTime:recovery.length?mean(recovery):null,saturationFraction:sat/trials,stressOOD:ratio>1});}
  return rows;
 }

 return {HISTORY_STEPS,BOUNDARIES,MIXTURE,DEFAULT_HP,HistoryBuffer,gaussianTerms,gaussianPpoLoss,gaussianPpoDerivatives,gaussianPolicy,availableWheelForce,tipAuthorityRatio,tipForceForAuthority,privilegedInput,sampleFamily,makeEpisodeSchedule,sampleEpisodeDisturbance,forcesAt,AdaptiveBoundary,robustReward,Trainer,restoreTrainer,rollout,evaluateEnvelope,evaluateGateFamily};
})();
if(typeof module!=='undefined')module.exports=RobustV2;
