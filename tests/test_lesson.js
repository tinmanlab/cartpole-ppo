'use strict';
const assert=require('node:assert/strict'),fs=require('fs');
const E=require('../src/core'),H=require('../src/lesson');
fs.mkdirSync(__dirname+'/../evidence',{recursive:true});
const results=[];function test(name,f){f();results.push(name);console.log('PASS',name);}
function near(a,b,t=1e-9){assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t,`${a} != ${b}`);}
const T=new E.Trainer(123);T.iteration();const r={iter:T.iter,detail:T.detail,policy:T.snapshot(),hp:T.hp,updates:T.updates};
test('Same selected experience drives actor, critic and PPO views',()=>{const c=H.inspect(r,0);assert.deepEqual(c.q,r.detail.batchData[0]);near(c.pa[0]+c.pa[1],1);near(c.loss.ratio,c.pa[c.q.action]/Math.exp(c.q.oldLogp));});
test('All 16 neurons: five real products plus bias match tanh activation',()=>{const c=H.inspect(r,0);for(const kind of ['actor','critic'])for(let h=0;h<16;h++){const n=H.neuron(c,kind,h);near(n.terms.reduce((s,q)=>s+q.product,0)+n.bias,n.z);near(Math.tanh(n.z),n.activation);}});
test('GAE target uses unnormalized advantage, not standardized learning signal',()=>{const c=H.inspect(r,0),g=H.gae(c.q,r.hp);near(g.delta,c.q.r+r.hp.gamma*(c.q.terminated?0:c.q.nextV)-c.q.oldV);near(g.target,c.q.oldV+c.q.rawAdv);near(g.delta+g.future,c.q.rawAdv);});
test('Every weight Adam calculation matches logged update',()=>{const c=H.inspect(r,0);for(const kind of ['actor','critic'])for(let k=0;k<c.d.before[kind].p.length;k++){const w=H.weight(c,kind,k);near(w.before+w.delta,w.after);near(w.m,.9*w.m0+.1*w.g);near(w.v,.999*w.v0+.001*w.g*w.g);near(w.delta,-w.lr*w.mhat/(Math.sqrt(w.vhat)+1e-8));}});
test('All 243 reverse gradients agree with finite differences on fixed experience',()=>{const c=H.inspect(r,1);for(const kind of ['actor','critic']){const model=c.models[kind],G=c.single[kind];for(let k=0;k<model.p.length;k++){const old=model.p[k],h=1e-5;const loss=()=>kind==='actor'?E.policyLoss(model.forward(c.q.obs).y,c.q.action,c.q.oldLogp,c.q.adv,r.hp.epsilon,r.hp.entropy).loss:.5*(model.forward(c.q.obs).y[0]-c.q.ret)**2;model.p[k]=old+h;const plus=loss();model.p[k]=old-h;const minus=loss();model.p[k]=old;near((plus-minus)/(2*h),G[k],1e-6);}}});
test('Missing detail is explicit instead of stale or invented values',()=>{assert.equal(H.inspect({iter:0},0),null);assert.equal(H.inspect(r,999),null);});
test('One manual pulse is time-bounded and adds to force without teleportation',()=>{const a=H.probe(r.policy,'nominal',1,10,4),b=H.probe(r.policy,'nominal',1,10,0);assert.deepEqual(a.trace[0].s,b.trace[0].s);assert.ok(a.trace.every(f=>f.userForce===0||(f.step>=10&&f.step<20&&f.userForce===4)));});
test('Policy validation refuses malformed model before usage',()=>{H.validatePolicy(r.policy);const bad=JSON.parse(JSON.stringify(r.policy));bad.actor.p[0]=null;assert.throws(()=>H.validatePolicy(bad));});
fs.writeFileSync(__dirname+'/../evidence/lesson_tests.json',JSON.stringify({pass:results.length,tests:results},null,2));
