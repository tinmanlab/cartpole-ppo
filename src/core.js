'use strict';
const P=typeof module!=='undefined'?require('./plant'):Plant;
// The identical, DOM-free engine is used by the display, Web Worker and tests.
const DT = 0.02;
const clip = (x,lo,hi) => Math.max(lo,Math.min(hi,x));
const avg = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
class RNG {
  constructor(seed=123){this.s=seed>>>0;this.spare=null;}
  uniform(){let t=this.s=(this.s+0x6D2B79F5)>>>0;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}
  normal(){if(this.spare!==null){const v=this.spare;this.spare=null;return v;}let x,y,q;do{x=2*this.uniform()-1;y=2*this.uniform()-1;q=x*x+y*y;}while(q===0||q>=1);const k=Math.sqrt(-2*Math.log(q)/q);this.spare=y*k;return x*k;}
}
// Educational parameter ranges, not measurements of a specific robot.
const PROFILES=['nominal','push','wind','model','sensor','actuator','mixed','ood'];
const PROFILE_NAMES={nominal:'기본',push:'반복 밀침',wind:'지속 바람',model:'질량·길이·마찰',sensor:'센서 잡음',actuator:'모터·명령 지연',mixed:'복합 · 학습범위',ood:'범위 밖 · OOD'};
function rewardParts(s,goal,spec=P.DEFAULT_SPEC){return {alive:1,position:-spec.rewardPosition*Math.min((s[0]-goal)**2,4),velocity:-spec.rewardVelocity*s[1]**2,angle:-spec.rewardAngle*(s[2]/(Math.PI/15))**2};}
class CartPole {
 constructor(rng=new RNG(7),options={}){this.rng=rng;this.noiseRng=new RNG(options.seed??91234);this.spec=P.validateSpec(options.spec||{actuator:'ideal',force:10});this.profile=options.profile||'nominal';this.level=options.level??1;this.timeLimit=500;this.enforceTimeLimit=true;this.reset(0);}
 configure(profile,level=1){if(!PROFILES.includes(profile)||!Number.isFinite(level)||level<0||level>1)throw Error('Invalid profile.');this.profile=profile;this.level=level;}
 randomize(){this.params=P.sample(this.spec,this.profile,this.level,this.noiseRng);this.forceQueue=[];this.motorForce=0;this.controlForce=0;this.lastOut=null;}
 reset(goal=0){this.s=Array.from({length:4},()=>.1*(this.rng.uniform()-.5));this.goal=goal;this.steps=0;this.return=0;this.done=false;this.terminated=false;this.truncated=false;this.validityLimit=false;this.randomize();this.refreshObservation();return this.obs();}
 refreshObservation(){this.sensed=this.s.map((x,i)=>x+this.params.noise[i]*this.noiseRng.normal());}
 obs(){const [x,v,t,w]=this.sensed;return [(this.goal-x)/2.4,v/2.5,t/(Math.PI/15),w/2.5,this.goal/2.4];}
 disturbance(){const p=this.params,k=this.steps-p.pushOffset;return p.bias+(k>=0&&k%p.pushPeriod<p.pushDuration?p.pushSign*(Math.floor(k/p.pushPeriod)%2?-1:1)*p.pushAmp:0);}
 step(action,externalForce=0){if(this.done)throw Error('Reset terminated environment.');if(action!==0&&action!==1||!Number.isFinite(externalForce))throw Error('Invalid action or external force.');const p=this.params,command=(action?1:-1)*this.spec.force;this.forceQueue.push(command);const delayed=this.forceQueue.length>p.delay?this.forceQueue.shift():0,requested=delayed*p.gain;
  const envForce=this.disturbance(),ext=externalForce+envForce;let drive,peakTractionRatio=0,lostContact=false;
  for(let k=0;k<4;k++){this.controlForce=p.tau>0?this.controlForce+(1-Math.exp(-.005/p.tau))*(requested-this.controlForce):requested;const r=P.integrate(this.s,this.spec,p,this.controlForce,ext,.005);this.s=r.state;drive=r.drive;peakTractionRatio=Math.max(peakTractionRatio,drive.tractionRatio);lostContact=lostContact||drive.contactLost;}drive.peakTractionRatio=peakTractionRatio;
  this.motorForce=drive.motorForce;this.steps++;this.terminated=Math.abs(this.s[0])>2.4||Math.abs(this.s[2])>Math.PI/15;this.validityLimit=peakTractionRatio>1||lostContact;
  // A no-slip model cannot truthfully continue after its friction-cone bound.
  if(this.validityLimit)this.terminated=true;this.truncated=this.enforceTimeLimit&&this.steps>=this.timeLimit;this.done=this.terminated||this.truncated;
  const parts=rewardParts(this.s,this.goal,this.spec),reward=Object.values(parts).reduce((a,b)=>a+b,0);this.return+=reward;this.refreshObservation();this.lastOut={reward,parts,terminated:this.terminated,truncated:this.truncated,done:this.done,command,requested,motorForce:this.motorForce,force:drive.contactForce+ext-p.friction*this.s[1],externalForce:ext,userForce:externalForce,envForce,xa:drive.acc,ta:drive.alpha,drive,failureReason:this.validityLimit?'no_slip_model_limit':Math.abs(this.s[2])>Math.PI/15?'pole_angle':Math.abs(this.s[0])>2.4?'track_limit':null};return this.lastOut;
 }
}

class MLP {
  constructor(rng=new RNG(),n=5,h=16,o=2,outScale=.01){
    this.n=n;this.h=h;this.o=o;this.w1=0;this.b1=h*n;this.w2=this.b1+h;this.b2=this.w2+o*h;
    this.p=new Float64Array(this.b2+o);this.m=new Float64Array(this.p.length);this.v=new Float64Array(this.p.length);this.t=0;
    for(let i=0;i<h*n;i++)this.p[i]=rng.normal()*Math.sqrt(2/(n+h));
    for(let i=this.w2;i<this.b2;i++)this.p[i]=rng.normal()*outScale;
  }
  forward(x){const h=new Float64Array(this.h),y=new Float64Array(this.o);
    for(let i=0;i<this.h;i++){let z=this.p[this.b1+i];for(let j=0;j<this.n;j++)z+=this.p[i*this.n+j]*x[j];h[i]=Math.tanh(z);}
    for(let i=0;i<this.o;i++){let z=this.p[this.b2+i];for(let j=0;j<this.h;j++)z+=this.p[this.w2+i*this.h+j]*h[j];y[i]=z;}
    return {x,h,y};
  }
  // Adds exact reverse-mode derivatives to the batch gradient, no numerical training.
  backward(f,dy,G,scale=1){const dz=new Float64Array(this.h);
    for(let i=0;i<this.o;i++){G[this.b2+i]+=dy[i]*scale;for(let j=0;j<this.h;j++)G[this.w2+i*this.h+j]+=dy[i]*f.h[j]*scale;}
    for(let j=0;j<this.h;j++){let d=0;for(let i=0;i<this.o;i++)d+=this.p[this.w2+i*this.h+j]*dy[i];dz[j]=d*(1-f.h[j]*f.h[j]);G[this.b1+j]+=dz[j]*scale;for(let k=0;k<this.n;k++)G[j*this.n+k]+=dz[j]*f.x[k]*scale;}
    return dz;
  }
  adam(G,lr,maxNorm=.5){const norm=Math.sqrt(G.reduce((s,v)=>s+v*v,0)),scale=Math.min(1,maxNorm/(norm+1e-12));this.t++;
    const bc1=1-.9**this.t,bc2=1-.999**this.t;let demo;
    for(let i=0;i<this.p.length;i++){const g=G[i]*scale,before=this.p[i];this.m[i]=.9*this.m[i]+.1*g;this.v[i]=.999*this.v[i]+.001*g*g;
      const mh=this.m[i]/bc1,vh=this.v[i]/bc2,delta=-lr*mh/(Math.sqrt(vh)+1e-8);this.p[i]+=delta;
      if(i===0)demo={before,after:this.p[i],rawGradient:G[i],g,m:this.m[i],v:this.v[i],mh,vh,delta,t:this.t};
    }
    return {norm,scale,demo};
  }
  snapshot(){return {n:this.n,h:this.h,o:this.o,p:Array.from(this.p),t:this.t};}
  optimizerSnapshot(){return {...this.snapshot(),m:Array.from(this.m),v:Array.from(this.v)};}
  static from(s){const n=new MLP(new RNG(1),s.n,s.h,s.o);n.p.set(s.p);n.t=s.t||0;if(s.m)n.m.set(s.m);if(s.v)n.v.set(s.v);return n;}
}
function probabilities(logits){const d=clip(logits[1]-logits[0],-60,60),r=1/(1+Math.exp(-d));return [1-r,r];}
function policy(model,obs,det=true,rng=null){const f=model.forward(obs),p=probabilities(f.y),a=det?(p[1]>=.5?1:0):(rng.uniform()<p[0]?0:1);return {a,p,f,logp:Math.log(Math.max(1e-12,p[a]))};}
function policyLoss(logits,action,oldLogp,adv,epsilon=.2,entropyCoef=.005){
  const p=probabilities(logits),logp=Math.log(Math.max(1e-12,p[action])),ratio=Math.exp(logp-oldLogp);
  const active=adv>=0?ratio<=1+epsilon:ratio>=1-epsilon;
  const entropy=-p.reduce((s,v)=>s+v*Math.log(Math.max(v,1e-12)),0);
  const dlogp=active?-adv*ratio:0;
  const dy=p.map((v,i)=>dlogp*((i===action?1:0)-v)+entropyCoef*v*(entropy+Math.log(Math.max(v,1e-12))));
  const surrogate=-Math.min(ratio*adv,clip(ratio,1-epsilon,1+epsilon)*adv);
  return {dy,ratio,entropy,active,surrogate,loss:surrogate-entropyCoef*entropy};
}
function computeGAE(data,n,gamma=.99,lambda=.95){const carry=new Float64Array(n);
  for(let i=data.length-1;i>=0;i--){const q=data[i];q.delta=q.r+gamma*(q.terminated?0:q.nextV)-q.oldV;
    q.rawAdv=q.delta+gamma*lambda*(q.done?0:carry[q.env]);q.ret=q.rawAdv+q.oldV;carry[q.env]=q.rawAdv;}
  const m=avg(data.map(q=>q.rawAdv)),sd=Math.sqrt(avg(data.map(q=>(q.rawAdv-m)**2))+1e-8);
  data.forEach(q=>q.adv=(q.rawAdv-m)/(sd+1e-8));
}
class Trainer {
  constructor(seed=123,hp={}){this.seed=seed;this.rng=new RNG(seed);this.hp={gamma:.99,lambda:.95,epsilon:.2,lr:.0007,criticLR:.002,entropy:.005,epochs:4,batch:128,n:16,horizon:128,profile:'nominal',curriculum:true,plan:'fixed',plant:{...P.DEFAULT_SPEC},...hp};
    this.hp.plant=P.validateSpec(this.hp.plant);if(!['nominal','push','wind','model','sensor','actuator','mixed','randomized'].includes(this.hp.profile))throw Error('Invalid training profile');
    this.curriculum=P.newCurriculum(this.hp.plan);this.collectionProfile=P.profileFor(this.hp,this.curriculum);this.collectionLevel=P.levelFor(this.curriculum,0);
    this.actor=new MLP(this.rng);this.critic=new MLP(this.rng,5,16,1,.1);this.initial=Array.from(this.actor.p);this.envs=Array.from({length:this.hp.n},(_,i)=>{const e=new CartPole(this.rng,{spec:this.hp.plant,profile:this.collectionProfile,level:this.collectionLevel,seed:(seed+100003+i*8191)>>>0});e.reset(2*this.rng.uniform()-1);return e;});this.exposure={steps:0,forceSteps:0,noisySteps:0,actuatorSteps:0};
    this.trainedPlant=JSON.parse(JSON.stringify(this.hp.plant));this.trainedProfile=this.collectionProfile;this.iter=0;this.steps=0;this.episodes=0;this.scores=[];this.last={actorGrad:0,criticGrad:0,entropy:Math.log(2),clipFraction:0,piLoss:0,valueLoss:0,approxKL:0,delta:0,adamSteps:0};
  }
  *collectChunks(){this.collectionProfile=P.profileFor(this.hp,this.curriculum);this.collectionLevel=P.levelFor(this.curriculum,this.iter);const data=[],trace=[];for(let t=0;t<this.hp.horizon;t++){for(let i=0;i<this.envs.length;i++){
    const e=this.envs[i],obs=e.obs(),s=e.s.slice(),goal=e.goal,step=e.steps,ac=policy(this.actor,obs,false,this.rng),value=this.critic.forward(obs).y[0],out=e.step(ac.a),nextV=this.critic.forward(e.obs()).y[0];
    const q={env:i,obs,action:ac.a,oldLogp:ac.logp,oldV:value,r:out.reward,terminated:out.terminated,done:out.done,nextV,s,ns:e.s.slice(),goal,externalForce:out.externalForce,motorForce:out.motorForce,parts:out.parts,plant:this.hp.plant,drive:out.drive,profile:e.profile,params:{...e.params,noise:e.params.noise.slice()}};data.push(q);
    if(i===0)trace.push({s,ns:e.s.slice(),goal,step,action:ac.a,p:ac.p,value,reward:out.reward,done:out.done,terminated:out.terminated,externalForce:out.externalForce,obs:obs.slice(),motorForce:out.motorForce,drive:out.drive,plant:this.hp.plant,index:data.length-1});
    this.steps++;this.exposure.steps++;if(Math.abs(out.externalForce)>1e-12)this.exposure.forceSteps++;if(e.params.noise.some(x=>x>0))this.exposure.noisySteps++;if(e.params.delay||e.params.tau||e.params.gain!==1)this.exposure.actuatorSteps++;if(out.done){this.episodes++;this.scores.push(e.steps);if(this.scores.length>100)this.scores.shift();e.configure(P.profileFor(this.hp,this.curriculum),P.levelFor(this.curriculum,this.iter));e.reset(2*this.rng.uniform()-1);}
  }if((t+1)%16===0)yield {samples:data.length,total:this.hp.n*this.hp.horizon};}return {data,trace};}
  collect(){const it=this.collectChunks();let r;do{r=it.next();}while(!r.done);return r.value;}
  *optimize(data){this.updates=[];this.detail=null;const hp=this.hp,ids=Array.from({length:data.length},(_,i)=>i);let count=0,pi=0,vl=0,ent=0,cf=0,kl=0,trace=null,ga=0,gc=0,adam=null;
    for(let ep=0;ep<hp.epochs;ep++){
      for(let i=ids.length-1;i>0;i--){const j=Math.floor(this.rng.uniform()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
      for(let st=0;st<ids.length;st+=hp.batch){const end=Math.min(st+hp.batch,ids.length),size=end-st,GA=new Float64Array(this.actor.p.length),GC=new Float64Array(this.critic.p.length);
        const capture=ep===hp.epochs-1&&end===ids.length;
        const before=capture?{actor:this.actor.optimizerSnapshot(),critic:this.critic.optimizerSnapshot()}:null;
        let batchLoss=0,batchValue=0;
        for(let k=st;k<end;k++){const q=data[ids[k]],fa=this.actor.forward(q.obs),l=policyLoss(fa.y,q.action,q.oldLogp,q.adv,hp.epsilon,hp.entropy),dz=this.actor.backward(fa,l.dy,GA,1/size);
          const fc=this.critic.forward(q.obs),dv=fc.y[0]-q.ret;this.critic.backward(fc,[dv],GC,1/size);
          batchLoss+=l.loss/size;batchValue+=.5*dv*dv/size;
          pi+=l.surrogate;vl+=.5*dv*dv;ent+=l.entropy;cf+=!l.active;kl+=(l.ratio-1)-Math.log(l.ratio);count++;
          if(k===end-1)trace={obs:q.obs,action:q.action,adv:q.adv,rawAdv:q.rawAdv,delta:q.delta,ratio:l.ratio,oldLogp:q.oldLogp,dy:l.dy,dz:Array.from(dz),valueError:dv,epoch:ep+1,batch:Math.floor(st/hp.batch)+1};
        }
        const aa=this.actor.adam(GA,hp.lr),cc=this.critic.adam(GC,hp.criticLR);ga=aa.norm;gc=cc.norm;adam=aa.demo;
        this.updates.push({index:this.updates.length+1,epoch:ep+1,batch:Math.floor(st/hp.batch)+1,actorGrad:ga,criticGrad:gc,policyLoss:batchLoss,valueLoss:batchValue,actorW0:this.actor.p[0],criticW0:this.critic.p[0],actorDelta0:aa.demo.delta,criticDelta0:cc.demo.delta});
        if(capture){this.detail={epoch:ep+1,batch:Math.floor(st/hp.batch)+1,batchSize:size,before,after:{actor:this.actor.optimizerSnapshot(),critic:this.critic.optimizerSnapshot()},gradient:{actor:Array.from(GA),critic:Array.from(GC)},gradientScale:{actor:aa.scale,critic:cc.scale},batchData:ids.slice(st,end).map(i=>({...data[i],id:i,obs:data[i].obs.slice()})),batchLoss,batchValue};}
        yield {epoch:ep+1,batch:Math.floor(st/hp.batch)+1,totalBatches:Math.ceil(ids.length/hp.batch),actorGrad:ga,adamStep:this.actor.t};
      }
    }
    this.trainedPlant=JSON.parse(JSON.stringify(this.hp.plant));this.trainedProfile=this.collectionProfile;this.iter++;const delta=Math.sqrt(this.actor.p.reduce((s,p,i)=>s+(p-this.initial[i])**2,0));
    this.last={actorGrad:ga,criticGrad:gc,entropy:ent/count,clipFraction:cf/count,piLoss:pi/count,valueLoss:vl/count,approxKL:kl/count,delta,adamSteps:this.actor.t,adam,backprop:trace};
    if(![...this.actor.p,...this.critic.p].every(Number.isFinite))throw new Error('Non-finite parameters: training stopped.');
    return this.last;
  }
  iteration(){const r=this.collect();computeGAE(r.data,this.hp.n,this.hp.gamma,this.hp.lambda);for(const _ of this.optimize(r.data)){}return r;}
  snapshot(){return {modelVersion:'planar-bam/2',actor:this.actor.snapshot(),critic:this.critic.snapshot(),iter:this.iter,plant:JSON.parse(JSON.stringify(this.trainedPlant)),trainedProfile:this.trainedProfile,plan:this.hp.plan};}
  evaluate(count=12,seed=20260914){const rng=new RNG(seed),scores=[],returns=[],errors=[];let trace=[],reached=0;
    for(let k=0;k<count;k++){const e=new CartPole(rng,{spec:this.hp.plant,seed:seed+k*7919}),goal=[.8,-.8,0][k%3];e.reset(goal);const tail=[];
      while(!e.done){const s=e.s.slice(),step=e.steps,obs=e.obs(),ac=policy(this.actor,obs),value=this.critic.forward(obs).y[0],out=e.step(ac.a);
        if(e.steps>=350)tail.push(Math.abs(e.s[0]-goal));
        if(k===0)trace.push({s,ns:e.s.slice(),goal,step,action:ac.a,p:ac.p,value,reward:out.reward,done:out.done,terminated:out.terminated,externalForce:out.externalForce,obs:obs.slice(),motorForce:out.motorForce,drive:out.drive,plant:this.hp.plant});
      }
      scores.push(e.steps);returns.push(e.return);if(e.steps===500){const err=avg(tail);errors.push(err);if(err<.25)reached++;}
    }
    return {plant:this.hp.plant,profile:'nominal',mean:avg(scores),min:Math.min(...scores),max:Math.max(...scores),scores,returnMean:avg(returns),tailError:errors.length?avg(errors):null,survived:scores.filter(x=>x===500).length,reached,count,trace,seed};
  }
}
// Accumulates wall time; never speeds up physics or silently throws elapsed time away.
class RTClock {
  constructor(){this.reset();}
  reset(){this.acc=0;this.wall=0;this.sim=0;this.maxDebt=0;this.steps=0;}
  advance(seconds,step){this.wall+=seconds;this.acc+=seconds;let n=0;
    while(this.acc+1e-10>=DT&&n<200){if(step()===false){this.wall-=this.acc;this.acc=0;break;}this.acc-=DT;this.sim+=DT;this.steps++;n++;}
    this.acc=Math.max(0,this.acc);this.maxDebt=Math.max(this.maxDebt,this.acc);return n;
  }
  ratio(){return this.wall?this.sim/this.wall:1;}
}

// Policy-only testing. Independent RNG streams and identical exogenous conditions for each policy.
function rolloutPolicy(snapshot,profile='nominal',seed=810000,goal=.8,limit=500){
  const actor=MLP.from(snapshot.actor),critic=MLP.from(snapshot.critic),env=new CartPole(new RNG(seed),{profile,spec:snapshot.plant||{actuator:'ideal',force:10},seed:(seed+700001)>>>0});env.timeLimit=limit;env.reset(goal);
  const trace=[],tail=[];while(!env.done){const obs=env.obs(),s=env.s.slice(),ac=policy(actor,obs),v=critic.forward(obs).y[0],out=env.step(ac.a);trace.push({s,ns:env.s.slice(),obs,goal,step:env.steps-1,action:ac.a,p:ac.p,value:v,reward:out.reward,parts:out.parts,done:out.done,terminated:out.terminated,externalForce:out.externalForce,motorForce:out.motorForce});if(env.steps>=350)tail.push(Math.abs(env.s[0]-goal));}
  const error=env.steps===limit&&tail.length?avg(tail):null;
  return {trace,steps:env.steps,return:env.return,success:!env.terminated&&env.steps===limit&&error!==null&&error<.25,tailError:error,terminated:env.terminated,profile,seed,goal,params:env.params};
}
function evaluateProfile(snapshot,profile,count=24,seed=810000){const trials=[];for(let i=0;i<count;i++){const r=rolloutPolicy(snapshot,profile,seed+i*193,[.8,-.8,0][i%3]);const {trace,...t}=r;trials.push(t);}const successes=trials.filter(t=>t.success).length,failures=trials.filter(t=>t.terminated).length,completed=trials.filter(t=>!t.terminated);const p=successes/count,z=1.96,den=1+z*z/count,center=(p+z*z/(2*count))/den,half=z*Math.sqrt(p*(1-p)/count+z*z/(4*count*count))/den;return {profile,count,successes,failures,meanSteps:avg(trials.map(t=>t.steps)),minSteps:Math.min(...trials.map(t=>t.steps)),tailError:completed.length?avg(completed.map(t=>t.tailError)):null,interval:[center-half,center+half],trials};}
function evaluateSuite(snapshot,count=24,seed=810000){return PROFILES.map(p=>evaluateProfile(snapshot,p,count,seed));}
function rngState(r){return {s:r.s,spare:r.spare};}
function restoreRng(s){if(!s||!Number.isInteger(s.s)||s.s<0||s.s>4294967295||(s.spare!==null&&!Number.isFinite(s.spare)))throw new Error('Invalid RNG.');const r=new RNG(s.s);r.spare=s.spare;return r;}
function trainerCheckpoint(t){return {schema:'cartpole-bam-checkpoint/v2',modelVersion:'planar-bam/2',seed:t.seed,hp:JSON.parse(JSON.stringify(t.hp)),iter:t.iter,steps:t.steps,episodes:t.episodes,scores:t.scores.slice(),initial:t.initial.slice(),rng:rngState(t.rng),actor:t.actor.optimizerSnapshot(),critic:t.critic.optimizerSnapshot(),last:t.last,exposure:t.exposure,curriculum:t.curriculum,collectionProfile:t.collectionProfile,collectionLevel:t.collectionLevel,trainedPlant:t.trainedPlant,trainedProfile:t.trainedProfile,envs:t.envs.map(e=>{const {rng,noiseRng,...state}=e;return {...state,noiseRng:rngState(noiseRng)};})};}
// A checkpoint is user-supplied data. Reject prototype keys before Object.assign,
// then validate the numeric metadata that is later interpolated into teaching UI.
function validateCheckpointMetadata(cp){
 const walk=(value,depth=0)=>{if(depth>32)throw Error('Checkpoint nesting is too deep.');
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
   if(['__proto__','prototype','constructor'].includes(key))throw Error('Unsafe checkpoint key.');walk(child,depth+1);
  }
 };walk(cp);
 const uint=x=>Number.isSafeInteger(x)&&x>=0,finite=Number.isFinite;
 const c=cp.curriculum,profiles=['nominal','push','wind','model','sensor','actuator','mixed'];
 if(!cp.trainedPlant||!profiles.includes(cp.trainedProfile)||!profiles.includes(cp.collectionProfile)||!finite(cp.collectionLevel)||cp.collectionLevel<0||cp.collectionLevel>1)throw Error('Invalid checkpoint policy provenance.');
 P.validateSpec(cp.trainedPlant);
 const grade=r=>r&&uint(r.iter)&&r.iter<=cp.iter&&uint(r.passed)&&uint(r.count)&&r.count>0&&r.passed<=r.count;
 if(!c||!uint(c.phaseStart)||c.phaseStart>cp.iter||!Array.isArray(c.history)||c.history.length>100)throw Error('Invalid curriculum metadata.');
 if(c.last!==null&&(!grade(c.last)||!profiles.includes(c.last.profile)))throw Error('Invalid curriculum assessment.');
 for(const h of c.history)if(!grade(h)||!P.STAGES.includes(h.next)||typeof h.promoted!=='boolean'||!finite(h.rate)||Math.abs(h.rate-h.passed/h.count)>1e-12)throw Error('Invalid curriculum history.');
 const x=cp.exposure;if(!x||!['steps','forceSteps','noisySteps','actuatorSteps'].every(k=>uint(x[k]))||['forceSteps','noisySteps','actuatorSteps'].some(k=>x[k]>x.steps))throw Error('Invalid exposure statistics.');
 const last=cp.last;if(!last||!['actorGrad','criticGrad','entropy','clipFraction','piLoss','valueLoss','approxKL','delta','adamSteps'].every(k=>finite(last[k])))throw Error('Invalid learning statistics.');
 if(last.adam){const a=last.adam;if(!['before','after','rawGradient','g','m','v','mh','vh','delta'].every(k=>finite(a[k]))||!uint(a.t))throw Error('Invalid Adam annotation.');}
 if(last.backprop){const b=last.backprop,arr=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(finite);
  if(!arr(b.obs,5)||!arr(b.dy,2)||!arr(b.dz,16)||![0,1].includes(b.action)||!uint(b.epoch)||!uint(b.batch)||!['adv','rawAdv','delta','ratio','oldLogp','valueError'].every(k=>finite(b[k])))throw Error('Invalid backpropagation annotation.');
 }
}
function restoreTrainer(cp){
 const finite=Number.isFinite,arr=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(finite),uint=x=>Number.isInteger(x)&&x>=0;
 if(cp?.schema!=='cartpole-bam-checkpoint/v2'||cp.modelVersion!=='planar-bam/2')throw Error('This viewer requires a v2 BAM checkpoint. Open older checkpoints in the archived Korean viewer; do not reinterpret physics silently.');
 if(!uint(cp.seed)||cp.seed>4294967295||![cp.iter,cp.steps,cp.episodes].every(uint))throw Error('Invalid checkpoint header.');
 validateCheckpointMetadata(cp);
 const h=cp.hp;if(!h||h.n!==16||h.horizon!==128||h.batch!==128||h.epochs!==4||!['nominal','randomized','push','wind','sensor','model','actuator','mixed'].includes(h.profile)||!['lr','criticLR','gamma','lambda','epsilon','entropy'].every(k=>finite(h[k]))||h.lr<=0||h.lr>.01||h.criticLR<=0||h.criticLR>.02||h.gamma<0||h.gamma>1||h.lambda<0||h.lambda>1||h.epsilon<=0||h.epsilon>=1||h.entropy<0||h.entropy>1)throw Error('Invalid checkpoint configuration.');P.validateSpec(h.plant);P.newCurriculum(h.plan);
 for(const [k,o,n] of [['actor',2,130],['critic',1,113]]){const m=cp[k];if(!m||m.n!==5||m.h!==16||m.o!==o||!arr(m.p,n)||!arr(m.m,n)||!arr(m.v,n)||m.v.some(x=>x<0)||!uint(m.t)||m.t!==cp.iter*64)throw Error('Invalid optimizer checkpoint.');}
 if(!arr(cp.initial,130)||!Array.isArray(cp.envs)||cp.envs.length!==16||!Array.isArray(cp.scores)||!cp.scores.every(x=>uint(x)&&x<=500))throw Error('Invalid state.');
 const cc=cp.curriculum;if(!cc||cc.plan!==h.plan||!uint(cc.index)||cc.index>=P.STAGES.length||!uint(cc.streak)||!Array.isArray(cc.history)||cc.history.length>100)throw Error('Invalid curriculum.');
 for(const e of cp.envs){P.validateSpec(e.spec);if(JSON.stringify(e.spec)!==JSON.stringify(h.plant)||!PROFILES.includes(e.profile)||!arr(e.s,4)||!arr(e.sensed,4)||!finite(e.controlForce)||!finite(e.motorForce)||!uint(e.steps)||e.steps>500||!finite(e.level)||e.level<0||e.level>1||!finite(e.goal)||Math.abs(e.goal)>1||e.enforceTimeLimit!==true||e.timeLimit!==500||!Array.isArray(e.forceQueue)||e.forceQueue.length>6||!e.forceQueue.every(finite))throw Error('Invalid environment.');const p=e.params;if(!p||!arr(p.noise,4)||!Object.values(p).every(v=>Array.isArray(v)||typeof v==='string'||finite(v))||p.mc<=0||p.mp<=0||p.l<=0||p.tau<0||!uint(p.delay)||p.delay>8||p.pushPeriod<1)throw Error('Invalid physics.');restoreRng(e.noiseRng);}
 const t=new Trainer(cp.seed,h);t.rng=restoreRng(cp.rng);t.actor=MLP.from(cp.actor);t.critic=MLP.from(cp.critic);for(const k of ['iter','steps','episodes','scores','initial','last','exposure','curriculum','collectionProfile','collectionLevel','trainedPlant','trainedProfile'])t[k]=JSON.parse(JSON.stringify(cp[k]));t.envs=cp.envs.map(s=>{const e=Object.create(CartPole.prototype);Object.assign(e,JSON.parse(JSON.stringify(s)));e.rng=t.rng;e.noiseRng=restoreRng(s.noiseRng);return e;});return t;
}
Trainer.prototype.assessCurriculum=function(){if(this.hp.plan!=='staged'||this.iter%5!==0)return null;const snapshot=this.snapshot(),profile=P.profileFor(this.hp,this.curriculum),r=evaluateProfile(snapshot,profile,8,606060),promoted=P.gradeCurriculum(this.curriculum,{passed:r.successes,count:8,profile},this.iter);if(promoted){for(const e of this.envs){e.configure(P.profileFor(this.hp,this.curriculum),1);e.reset(2*this.rng.uniform()-1);}this.scores=[];}return {profile,passed:r.successes,count:8,promoted,next:P.profileFor(this.hp,this.curriculum),state:JSON.parse(JSON.stringify(this.curriculum))};};
Trainer.prototype.continueConditions=function(plant,profile,plan){const next=P.validateSpec(plant);const curriculum=P.newCurriculum(plan);if(!['nominal','push','wind','model','sensor','actuator','mixed','randomized'].includes(profile))throw Error('Invalid profile');this.hp.plant=next;this.hp.profile=profile;this.hp.plan=plan;this.curriculum=curriculum;this.curriculum.phaseStart=this.iter;this.collectionProfile=P.profileFor(this.hp,this.curriculum);this.scores=[];this.envs=this.envs.map((_,i)=>new CartPole(this.rng,{spec:this.hp.plant,profile:this.collectionProfile,level:P.levelFor(this.curriculum,this.iter),seed:(this.seed+this.iter*101+i*8191)>>>0}));};

if(typeof module!=='undefined')module.exports={DT,clip,avg,RNG,CartPole,MLP,probabilities,policy,policyLoss,computeGAE,Trainer,RTClock,PROFILES,PROFILE_NAMES,rewardParts,rolloutPolicy,evaluateProfile,evaluateSuite,trainerCheckpoint,restoreTrainer};
