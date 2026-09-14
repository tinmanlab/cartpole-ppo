'use strict';
// Read-only explanations of the same stored computations used by the optimizer.
const Lesson = (()=>{
 const E=typeof module!=='undefined'&&module.exports?require('./core'):{MLP,policyLoss,probabilities,CartPole,RNG,policy,avg,DT};
 function inspect(record,index){const d=record?.detail,q=d?.batchData?.[index];if(!q)return null;
  const models={actor:E.MLP.from(d.before.actor),critic:E.MLP.from(d.before.critic)},after={actor:E.MLP.from(d.after.actor),critic:E.MLP.from(d.after.critic)};
  const fa=models.actor.forward(q.obs),fc=models.critic.forward(q.obs),loss=E.policyLoss(fa.y,q.action,q.oldLogp,q.adv,record.hp.epsilon,record.hp.entropy);
  const single={actor:new Float64Array(models.actor.p.length),critic:new Float64Array(models.critic.p.length)};
  const dz={actor:models.actor.backward(fa,loss.dy,single.actor),critic:models.critic.backward(fc,[fc.y[0]-q.ret],single.critic)};
  return {record,d,q,models,after,fa,fc,loss,single,dz,pa:E.probabilities(fa.y),afterP:E.probabilities(after.actor.forward(q.obs).y),afterV:after.critic.forward(q.obs).y[0]};
 }
 function neuron(c,kind,index){const m=c.models[kind],pass=kind==='actor'?c.fa:c.fc;const terms=c.q.obs.map((input,i)=>({input,weight:m.p[index*5+i],product:input*m.p[index*5+i]})),bias=m.p[m.b1+index],z=terms.reduce((s,t)=>s+t.product,bias);return {terms,bias,z,activation:pass.h[index],h:index};}
 function name(m,k){if(k<m.b1)return `W₁[h${Math.floor(k/5)+1}, o${k%5+1}]`;if(k<m.w2)return `b₁[h${k-m.b1+1}]`;if(k<m.b2)return `W₂[y${Math.floor((k-m.w2)/16)+1}, h${(k-m.w2)%16+1}]`;return `b₂[y${k-m.b2+1}]`;}
 function weight(c,kind,index){const before=c.d.before[kind],after=c.d.after[kind],G=c.d.gradient[kind][index],scale=c.d.gradientScale[kind],g=G*scale,t=after.t,m=after.m[index],v=after.v[index];return {kind,index,label:name(c.models[kind],index),before:before.p[index],after:after.p[index],delta:after.p[index]-before.p[index],single:c.single[kind][index],G,scale,g,t,m,v,m0:before.m[index],v0:before.v[index],mhat:m/(1-.9**t),vhat:v/(1-.999**t),lr:kind==='actor'?c.record.hp.lr:c.record.hp.criticLR};}
 function gae(q,hp){return {delta:q.delta,bootstrap:hp.gamma*(q.terminated?0:q.nextV),future:q.rawAdv-q.delta,raw:q.rawAdv,normalized:q.adv,target:q.oldV+q.rawAdv};}
 function validatePolicy(s){if(!s||!Number.isInteger(s.iter)||s.iter<0)throw new Error('Invalid policy iteration.');for(const [kind,o,n] of [['actor',2,130],['critic',1,113]]){const m=s[kind];if(!m||m.n!==5||m.h!==16||m.o!==o||!Array.isArray(m.p)||m.p.length!==n||!m.p.every(Number.isFinite)||!Number.isInteger(m.t)||m.t<0)throw new Error('Invalid policy architecture or parameters.');}return s;}
 // Fixed held-out seeds. This is an independent experiment, never training data.
 function probe(snapshot,profile='nominal',seed=818181,pulseAt=150,pulseN=0,pulseSteps=10,goal=.8){
  validatePolicy(snapshot);
  if(!Number.isInteger(pulseAt)||pulseAt<0||pulseAt>=500||!Number.isInteger(pulseSteps)||pulseSteps<0||pulseSteps>500||!Number.isFinite(pulseN)||Math.abs(pulseN)>40||!Number.isFinite(goal)||Math.abs(goal)>1)throw Error('Invalid probe: pulse time, force, duration or goal.');
  const a=E.MLP.from(snapshot.actor),v=E.MLP.from(snapshot.critic),env=new E.CartPole(new E.RNG(seed),{profile,spec:snapshot.plant||{actuator:'ideal',force:10},seed:(seed+77197)>>>0});env.reset(goal);
  const trace=[],tail=[];let applied=0;
  while(!env.done){const step=env.steps,obs=env.obs(),s=env.s.slice(),ac=E.policy(a,obs),external=step>=pulseAt&&step<pulseAt+pulseSteps?pulseN:0,estimated=v.forward(obs).y[0],out=env.step(ac.a,external);if(external)applied++;
   trace.push({s,ns:env.s.slice(),obs,goal,step,action:ac.a,p:ac.p,value:estimated,plant:env.spec,reward:out.reward,...out});if(env.steps>=350)tail.push(Math.abs(env.s[0]-goal));}
  const success=!env.terminated&&env.steps===500&&E.avg(tail)<.25;
  const pulseReached=applied>0, pulseCompleted=pulseN!==0&&applied===pulseSteps;
  const failureReason=env.lastOut?.failureReason||(!success?'tracking_error':null);
  let recoveryTime=null, consecutive=0;
  if(pulseCompleted){for(const f of trace){if(f.step<pulseAt+pulseSteps)continue;
    const [x,v,t,w]=f.ns;
    const settled=Math.abs(x-goal)<.25&&Math.abs(v)<.25&&Math.abs(t)<3*Math.PI/180&&Math.abs(w)<.4;
    consecutive=settled?consecutive+1:0;
    if(consecutive>=25){recoveryTime=(f.step+1-25-(pulseAt+pulseSteps))*E.DT;break;}
  }}
  return {profile,seed,steps:env.steps,terminated:env.terminated,truncated:env.truncated,success,
    tailError:env.terminated?null:E.avg(tail),return:env.return,pulseAt,pulseN,pulseSteps,pulseApplied:applied,
    pulseReached,pulseCompleted,requestedImpulse:pulseN*pulseSteps*E.DT,
    deliveredImpulse:pulseN*applied*E.DT,recoveryTime,failureReason,
    outcome:failureReason==='no_slip_model_limit'?'model_invalid':success?'pass':failureReason,
    maxAngleDegrees:Math.max(...trace.map(f=>Math.abs(f.ns[2])*180/Math.PI)),
    peakTractionRatio:Math.max(...trace.map(f=>f.drive?.peakTractionRatio||0)),trace};
 }
 return {inspect,neuron,weight,gae,name,validatePolicy,probe};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=Lesson;
