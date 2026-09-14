'use strict';
const assert=require('assert');
const P=require('../src/plant');
const E=require('../src/core');
let count=0;function test(name,f){f();console.log('PASS',name);count++;}
test('bundled three distinct real M6 datasets',()=>{assert.deepEqual(Object.keys(P.ACTUATORS).sort(),['ideal','mx106','mx64','xl330']);assert(P.ACTUATORS.xl330.kt!==P.ACTUATORS.mx64.kt);});
test('BAM DC equation and back EMF',()=>{const a=P.ACTUATORS.xl330;assert(Math.abs(P.motorTorque(a,2,0)-a.kt*2/a.R)<1e-12);assert(P.motorTorque(a,2,10)<P.motorTorque(a,2,0));});
test('invalid ranges rejected',()=>{assert.throws(()=>P.validateSpec({...P.DEFAULT_SPEC,mc:0}));assert.throws(()=>P.validateSpec({...P.DEFAULT_SPEC,actuator:'fake'}));assert.throws(()=>P.validateSpec({...P.DEFAULT_SPEC,pushMin:.8,pushMax:.2}));});
test('training and inference carry same plant spec',()=>{let t=new E.Trainer(17,{plant:{...P.DEFAULT_SPEC,actuator:'xl330'},profile:'nominal',plan:'fixed'});assert.equal(t.envs[0].spec.actuator,'xl330');assert.equal(t.snapshot().plant.actuator,'xl330');assert.equal(t.evaluate(1).plant.actuator,'xl330');});
test('BAM state differs from ideal and wheel state actually advances',()=>{const sp={...P.DEFAULT_SPEC,actuator:'xl330'},a=new E.CartPole(new E.RNG(2),{spec:sp}),b=new E.CartPole(new E.RNG(2),{spec:{...sp,actuator:'ideal'}});for(let i=0;i<3;i++){a.step(1);b.step(1);}assert.notDeepEqual(a.s,b.s);assert(a.lastOut.drive);assert(Math.abs(a.lastOut.drive.rotorSpeed-a.s[1]/(sp.ratio*P.WHEEL.radius))<10);});
test('all actual motor profiles finite in rollout',()=>{for(const actuator of ['xl330','mx64','mx106']){const e=new E.CartPole(new E.RNG(51),{spec:{...P.DEFAULT_SPEC,actuator}});for(let i=0;i<10&&!e.done;i++)e.step(i%2);assert(e.s.every(Number.isFinite));}});
test('performance gate holds rather than promoting on iteration count',()=>{const g=P.newCurriculum('staged');for(let i=0;i<20;i++)P.gradeCurriculum(g,{passed:0,count:8},(i+1)*5);assert.equal(g.index,0);});
test('two actual passing gates promote one stage only',()=>{const g=P.newCurriculum('staged');P.gradeCurriculum(g,{passed:8,count:8},5);assert.equal(g.index,0);P.gradeCurriculum(g,{passed:8,count:8},10);assert.equal(g.index,1);assert.equal(g.history.length,2);});
console.log(JSON.stringify({passed:count}));

require("fs").writeFileSync(__dirname+"/../evidence/bam_tests.json",JSON.stringify({passed:count}));
