'use strict';
const assert=require('node:assert/strict');
const P=require('../src/plant');
const {CartPole,RNG}=require('../src/core');
let checks=0;
function test(name,fn){fn();console.log('PASS',name);checks++;}
function near(a,b,tol=1e-9){assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);}
const spec=P.validateSpec({actuator:'ideal',force:8}),p={mc:1,mp:.1,l:.5,friction:0};
test('A horizontal pole-tip force accelerates the rod, not just the cart',()=>{
 const tip=P.integrate([0,0,0,0],spec,p,0,0,.005,1);
 const body=P.integrate([0,0,0,0],spec,p,0,1,.005);
 assert.ok(tip.drive.alpha>0);assert.ok(body.drive.alpha<0);
});
test('Pole-tip integration satisfies both coupled generalized-force equations',()=>{
 for(const angle of [-.18,0,.16])for(const force of [-.4,.2,1]){
  const s=[.1,.08,angle,-.3],r=P.integrate(s,spec,p,2,.5,.005,force),d=r.drive;
  near((p.mc+p.mp)*d.acc+p.mp*p.l*Math.cos(angle)*d.alpha,
    2+.5+force+p.mp*p.l*s[3]**2*Math.sin(angle),1e-9);
  near(4/3*p.mp*p.l**2*d.alpha+p.mp*p.l*Math.cos(angle)*d.acc,
    p.mp*spec.gravity*p.l*Math.sin(angle)+2*p.l*Math.cos(angle)*force,1e-9);
 }
});
test('Zero tip force preserves legacy body-force trajectories exactly',()=>{
 const a=new CartPole(new RNG(7),{spec,seed:222}),b=new CartPole(new RNG(7),{spec,seed:222});
 for(let k=0;k<8&&!a.done;k++){a.step(k%2,.25);b.step(k%2,.25,0);assert.deepEqual(a.s,b.s);}
});
test('New external wrench is explicit in telemetry; body-force field retains its meaning',()=>{
 const e=new CartPole(new RNG(7),{spec,seed:222});const o=e.step(1,.2,.1);
 near(o.userForce,.2);near(o.tipForce,.1);assert.equal(o.tipApplicationPoint,'pole_tip');
 assert.ok(Number.isFinite(o.tipMoment));
});
test('Invalid tip load fails before environment, queue or counters change',()=>{
 for(const f of [NaN,Infinity,-Infinity]){const e=new CartPole(new RNG(7),{spec});const before=JSON.stringify(e);assert.throws(()=>e.step(1,0,f));assert.equal(JSON.stringify(e),before);}
});
test('BAM wheel force still responds to policy command while a tip force is present',()=>{
 const sp=P.validateSpec({actuator:'xl330'}),pp={...p};
 const a=P.integrate([0,0,0,0],sp,pp,-8,0,.005,.1),b=P.integrate([0,0,0,0],sp,pp,8,0,.005,.1);
 assert.ok(a.drive.motorForce<b.drive.motorForce);assert.ok(a.drive.acc<b.drive.acc);
});
test('Strong tip disturbances stop explicitly without hiding contact validity limits',()=>{
 const e=new CartPole(new RNG(7),{spec:P.validateSpec({})});
 for(let k=0;k<100&&!e.done;k++)e.step(1,0,12);
 assert.ok(e.done);assert.ok(['no_slip_model_limit','pole_angle','track_limit'].includes(e.lastOut.failureReason));
});
test('Sixty zero-tip states match the original pinned plant blob exactly',()=>{
 // Reference: d146df7bf9d46b0f0d9a4c827c2415e7975dd819 before this extension.
 const states=[];for(const actuator of ['ideal','xl330','mx64','mx106'])for(let i=0;i<15;i++){
  const sp=P.validateSpec({actuator}),pp={mc:1,mp:.1,l:.5,friction:.02};
  states.push(P.integrate([.1,Math.sin(i)*.2,Math.cos(i)*.1,i*.07],sp,pp,(i%2?1:-1)*8,Math.sin(i+2),.005).state);
 }
 const hash=require('crypto').createHash('sha256').update(JSON.stringify(states)).digest('hex');
 assert.equal(hash,'f7fc308f2706b52fb325ff088b330f76593dbab0a5489cd33e4c44c96036ae39');
});
test('BAM coupling satisfies the same mass matrix with wheel and rotor inertia',()=>{
 for(const actuator of ['xl330','mx64','mx106'])for(const command of [-8,8]){
  const sp=P.validateSpec({actuator}),s=[.1,.13,.12,-.3],o=P.integrate(s,sp,p,command,.2,.005,.1),d=o.drive,rg=P.WHEEL.radius*sp.ratio;
  const netDrive=d.motorForce-2*(d.frictionTorque+d.viscousTorque)/rg;
  near((p.mc+p.mp+d.reflectedMass)*d.acc+p.mp*p.l*Math.cos(s[2])*d.alpha,
   netDrive+.2+.1+p.mp*p.l*s[3]**2*Math.sin(s[2]),1e-8);
 }
});
console.log(JSON.stringify({passed:checks}));
