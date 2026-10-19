'use strict';

(() => {
 const $=id=>document.getElementById(id), L=ControlLab, P=Plant;
 const actor=CONTROL_LAB_ACTOR, residualModel=CONTROL_LAB_RESIDUAL||null;

 const descCtl={
  pid:{title:'PID · error를 바로 힘으로',why:'가장 직접적인 feedback. 모델 없이 오차의 현재값·변화·누적을 보고 반응합니다.',math:'eₓ = p − p*\nu = kθ θ + kdθ ω + kp eₓ + kv v + ki ∫eₓdt',take:'무엇을 보여주나: 모델이 없어도 feedback은 가능하지만, 여러 state의 trade-off와 constraint는 gain tuning에 숨어 있습니다.'},
  lqr:{title:'LQR · 모델 + quadratic cost',why:'upright 근처를 선형화하고, state와 힘의 비용을 동시에 최소화하는 feedback gain K를 계산합니다.',math:'xₖ₊₁ = A xₖ + B uₖ\nJ = Σ(xᵀQx + uᵀRu)\nu = −Kx',take:'PID와 달리 K가 A,B,Q,R에서 나옵니다. 하지만 선형화점과 unconstrained 가정이 핵심 경계입니다.'},
  mpc:{title:'MPC · 미래를 여러 step 최적화',why:'현재 x̂에서 여러 미래 state를 예측하고, force limit 안에서 control sequence를 최적화한 뒤 첫 힘만 적용합니다.',math:'min  Σ xₖᵀQxₖ + R uₖ²\ns.t. xₖ₊₁ = A xₖ + B uₖ\n     |uₖ| ≤ u_max\napply only u₀',take:'LQR과 같은 모델을 써도 horizon과 constraint 때문에 saturation/큰 외란에서 행동이 달라집니다.'},
  ppo:{title:'PPO · 데이터를 통해 policy를 학습',why:'A,B를 online으로 풀지 않고, 학습된 neural policy가 observation에서 좌/우 힘을 직접 고릅니다.',math:'o → Actor(o) → π(left), π(right)\na ~ π(a|o)  (viewer에서는 argmax)',take:'runtime 계산은 싸지만 어떤 robustness를 얻는지는 training distribution·reward·randomization에 의존합니다.'}
 };

 const descObs={
  truth:{title:'Truth / oracle',why:'observer가 없는 기준선. controller가 simulator의 실제 state를 직접 봅니다.',math:'x̂ = x_truth\nP = 0',take:'성능 상한 진단용일 뿐 real robot에서 허용되지 않습니다.'},
  raw:{title:'Raw sensor + finite difference',why:'위치 p와 각도 θ만 직접 보고, v와 ω는 한 step 차분으로 만듭니다.',math:'v̂ ≈ (pₖ−pₖ₋₁)/Δt\nω̂ ≈ wrap(θₖ−θₖ₋₁)/Δt',take:'noise를 미분하면 velocity noise가 커집니다. 왜 observer가 필요한지 가장 직관적으로 보여줍니다.'},
  kf:{title:'KF · 선형 prediction + uncertainty correction',why:'선형화된 A,B로 hidden velocity를 예측하고 P와 R을 이용해 measurement를 얼마나 믿을지 매 step 계산합니다.',math:'x̂⁻ = A x̂⁺ + B u\nP⁻ = A P⁺ Aᵀ + Q\nK = P⁻Hᵀ(HP⁻Hᵀ+R)⁻¹\nx̂⁺ = x̂⁻ + K(y−Hx̂⁻)',take:'지금까지 공부한 P,Q,R,K가 실제로 움직이는 모드입니다.'},
  ekf:{title:'EKF · nonlinear f를 쓰고 그 주변만 선형화',why:'plant prediction은 nonlinear f(x,u)를 사용하고, covariance 전파에 필요한 F=∂f/∂x만 현재점에서 선형화합니다.',math:'x̂⁻ = f(x̂⁺,u)\nF = ∂f/∂x |x̂\nP⁻ = F P⁺ Fᵀ + Q\nupdate는 KF와 같은 형태',take:'“로봇이 nonlinear인데 KF를 어떻게 쓰나?”에 대한 첫 답입니다.'},
  so2:{title:'SO(2) invariant-error bridge',why:'각도는 실수 직선이 아니라 원 위의 값이라는 점을 반영해 innovation과 state correction에서 angle wrap을 보존합니다.',math:'rθ = wrap(θ_meas − θ̂⁻)\nθ̂⁺ = wrap(θ̂⁻ + Δθ)\n\n※ Hartley SE₂(3) InEKF 자체는 아님',take:'CartPole에서는 효과가 작을 수 있습니다. 이 bridge 다음에 humanoid의 SO(3)/SE₂(3) InEKF가 등장합니다.'},
  residual:{title:'Learned residual · InNKF-style toy',why:'geometry-aware EKF 뒤에 작은 학습기가 “남은 state error”를 예측해 residual correction을 추가합니다.',math:'x̂_EKF⁺ → NN(history, innovation, u) → Δxθ\nx̂_final = x̂_EKF⁺ + Δxθ\n\n※ 논문의 SE₂(3)-TCN InNKF를 축약한 CartPole toy',take:'물리 observer를 버리지 않고 systematic residual만 학습하는 hybrid의 의미를 보여줍니다.'},
  adaptive:{title:'Adaptive R · CoCo/FOCUS bridge',why:'measurement가 의심스러울 때 state를 직접 NN으로 대체하지 않고 R을 키워 “덜 믿게” 합니다.',math:'w ∈ [0,1] = reliability\nR_eff = R₀[1 + 99(1−w)]\nR↑ ⇒ K↓ ⇒ measurement correction↓',take:'이 페이지의 w는 innovation heuristic이며 학습된 FOCUS/CoCo가 아닙니다. 목적은 learned reliability가 왜 R을 조절하는지 구조를 분리해 보는 것입니다.'}
 };

 const papers=[
  ['Hartley InEKF','stationary contact + Lie-group state로 floating-base 추정','https://arxiv.org/abs/1904.09251','so2'],
  ['Lin 2022','force sensor 대신 learned contact event → InEKF','https://proceedings.mlr.press/v164/lin22b.html',''],
  ['Youm / NMN','contact probability + body velocity를 neural measurement로','https://arxiv.org/abs/2402.00366',''],
  ['InNKF','TCN이 InEKF posterior residual을 학습해 보정','https://arxiv.org/abs/2503.00344','residual'],
  ['CoCo-InEKF','binary contact 대신 learned directional covariance','https://arxiv.org/abs/2605.15122','adaptive'],
  ['FOCUS','contact가 아니라 per-foot FK reliability를 학습해 R/measurement 조절','https://arxiv.org/abs/2609.02222','adaptive']
 ];

 let plant,controller,observer,prevU=0,running=true,lastTs=0,acc=0,trace=[],sumErr=0,nErr=0,lastEstimate=[0,0,0,0],lastMeasurement=[0,0],lastInnovation=[0,0],lastForce=0;

 function spec(){return {...P.DEFAULT_SPEC,actuator:'ideal',force:10,friction:0};}

 function rebuild(){
   plant=new L.LabPlant({seed:31,scenario:$('scenario').value,spec:spec()});plant.goal=+$('goal').value;
   controller=L.makeController($('controller').value,plant.spec,actor);
   observer=L.makeObserver($('observer').value,plant.spec,{model:residualModel});
   const y=plant.sensor();observer.reset(y,plant.s);controller.reset();prevU=0;trace=[];sumErr=0;nErr=0;lastEstimate=observer.x?.slice?.()||plant.s.slice();lastMeasurement=y;lastInnovation=[0,0];lastForce=0;renderConcepts();renderAll();
 }

 function stepOne(){
   const truth=plant.s.slice(),y=plant.sensor(),xh=observer.step(y,prevU,truth),u=controller.act(xh,plant.goal),out=plant.step(u);
   const e=truth.map((v,i)=>i===2?L.wrap(v-xh[i]):v-xh[i]);sumErr+=e.reduce((s,v)=>s+v*v,0);nErr+=4;
   lastEstimate=xh.slice();lastMeasurement=y.slice();lastInnovation=observer.last?.innovation?.slice?.()||[0,0];lastForce=u;prevU=u;
   trace.push({t:plant.steps*L.DT,truth:truth.slice(),estimate:xh.slice(),u,innovation:lastInnovation.slice(),P:observer.P?observer.P.map(r=>r.slice()):null,reliability:observer.last?.reliability?.slice?.()||null});

   if(trace.length>420)trace.shift();

   if(out.failed)running=false;
 }

 function world(){
   const c=$('world'),g=c.getContext('2d'),W=c.width,H=c.height;g.clearRect(0,0,W,H);g.fillStyle='#fbfdff';g.fillRect(0,0,W,H);const sx=150,ground=270,center=W/2,scale=120;
   g.strokeStyle='#d6e0e8';g.lineWidth=2;g.beginPath();g.moveTo(20,ground);g.lineTo(W-20,ground);g.stroke();

   for(let m=-2;m<=2;m++){const x=center+m*scale;g.strokeStyle='#e8eef3';g.beginPath();g.moveTo(x,ground-7);g.lineTo(x,ground+7);g.stroke();g.fillStyle='#7c8fa1';g.font='12px system-ui';g.fillText(m+' m',x-12,ground+23);}

   const draw=(s,color,dashed=false,alpha=1)=>{const x=center+s[0]*scale,theta=s[2],cartY=ground-30,Lp=145;g.save();g.globalAlpha=alpha;g.strokeStyle=color;g.fillStyle=color;g.lineWidth=4;g.setLineDash(dashed?[9,7]:[]);g.strokeRect(x-42,cartY-18,84,28);g.beginPath();g.arc(x-27,ground-9,11,0,Math.PI*2);g.arc(x+27,ground-9,11,0,Math.PI*2);g.stroke();const px=x,py=cartY-18,tx=px+Math.sin(theta)*Lp,ty=py-Math.cos(theta)*Lp;g.beginPath();g.moveTo(px,py);g.lineTo(tx,ty);g.stroke();g.beginPath();g.arc(tx,ty,7,0,Math.PI*2);g.fill();g.restore();};

   draw(plant.s,'#2e78c7',false,.88);draw(lastEstimate,'#b36b18',true,.9);
   const gx=center+plant.goal*scale;g.strokeStyle='#12845c';g.setLineDash([4,4]);g.beginPath();g.moveTo(gx,ground-55);g.lineTo(gx,ground+4);g.stroke();g.setLineDash([]);

   if(plant.pushLeft>0){g.strokeStyle='#bd4747';g.lineWidth=5;g.beginPath();const dir=Math.sign(plant.pushForce);g.moveTo(center+plant.s[0]*scale-dir*80,ground-80);g.lineTo(center+plant.s[0]*scale-dir*25,ground-80);g.stroke();}
 }

 function chart(canvas,keyTruth,keyEst){
   const g=canvas.getContext('2d'),W=canvas.width,H=canvas.height;g.clearRect(0,0,W,H);g.strokeStyle='#e6edf3';g.beginPath();g.moveTo(0,H/2);g.lineTo(W,H/2);g.stroke();

if(trace.length<2)return;
   const vals=[];

for(const q of trace){vals.push(keyTruth(q),keyEst(q));}

const M=Math.max(.03,...vals.map(Math.abs));
   const line=(fn,color)=>{g.strokeStyle=color;g.lineWidth=2;g.beginPath();trace.forEach((q,i)=>{const x=i/(trace.length-1)*(W-4)+2,y=H/2-fn(q)/M*(H*.42);i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke();};

line(keyTruth,'#2e78c7');line(keyEst,'#b36b18');
 }

 function uncertaintyChart(){
   const c=$('uncertChart'),g=c.getContext('2d'),W=c.width,H=c.height;g.clearRect(0,0,W,H);const rows=trace.filter(q=>q.P);

if(rows.length<2){g.fillStyle='#8091a0';g.font='12px system-ui';g.fillText('이 observer는 P를 사용하지 않습니다.',12,25);

return;}

const max=Math.max(.01,...rows.flatMap(q=>[Math.sqrt(Math.max(0,q.P[1][1])),Math.sqrt(Math.max(0,q.P[3][3]))]));const line=(idx,color)=>{g.strokeStyle=color;g.lineWidth=2;g.beginPath();rows.forEach((q,i)=>{const x=i/(rows.length-1)*(W-4)+2,y=H-8-Math.sqrt(Math.max(0,q.P[idx][idx]))/max*(H-18);i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke();};

line(1,'#7657b5');line(3,'#258e9a');g.fillStyle='#667b8e';g.font='10px system-ui';g.fillText('σ(v)',8,13);g.fillText('σ(ω)',45,13);
 }

 function renderMetrics(){
   $('clock').textContent='t='+(plant.steps*L.DT).toFixed(2)+' s';$('mTheta').textContent=(plant.s[2]*180/Math.PI).toFixed(2)+'°';$('mThetaHat').textContent=(lastEstimate[2]*180/Math.PI).toFixed(2)+'°';$('mRmse').textContent=Math.sqrt(sumErr/Math.max(1,nErr)).toFixed(3);$('mForce').textContent=lastForce.toFixed(2)+' N';$('mInnov').textContent=Math.hypot(...lastInnovation).toFixed(3);$('statusBadge').textContent=running?'RUNNING':'PAUSED';$('play').textContent=running?'일시정지':'재생';
 }

 function renderAll(){world();chart($('angleChart'),q=>q.truth[2]*180/Math.PI,q=>q.estimate[2]*180/Math.PI);uncertaintyChart();renderMetrics();}

 function renderConcepts(){
   const c=descCtl[$('controller').value],o=descObs[$('observer').value];$('controllerTitle').textContent=c.title;$('controllerWhy').textContent=c.why;$('controllerMath').textContent=c.math;$('controllerTake').textContent=c.take;$('observerTitle').textContent=o.title;$('observerWhy').textContent=o.why;$('observerMath').textContent=o.math;$('observerTake').textContent=o.take;
   $('lineage').innerHTML=papers.map(p=>`<div class="paper ${p[3]&&p[3]===$('observer').value?'active':''}"><b><a href="${p[2]}" target="_blank" rel="noopener">${p[0]}</a></b><span>${p[1]}</span></div>`).join('');
 }

 function loop(ts){if(!lastTs)lastTs=ts;const d=Math.min(.08,(ts-lastTs)/1000);lastTs=ts;

if(running){acc+=d;let n=0;

while(acc>=L.DT&&n<5){stepOne();acc-=L.DT;n++;}}

renderAll();requestAnimationFrame(loop);}

 function compare(){
   const cs=['pid','lqr','mpc','ppo'],os=['truth','kf','ekf','so2','residual','adaptive'],scenario=$('scenario').value;let html='<thead><tr><th>Controller</th>'+os.map(o=>'<th>'+({truth:'Truth',kf:'KF',ekf:'EKF',so2:'SO(2)',residual:'Residual',adaptive:'Adapt-R'}[o])+'</th>').join('')+'</tr></thead><tbody>';

   for(const c of cs){html+='<tr><td>'+c.toUpperCase()+'</td>';

for(const o of os){const r=L.runEpisode({controller:c,observer:o,scenario,seed:77,steps:300,goal:+$('goal').value,actor,residualModel,pushAt:120,pushForce:3});html+=`<td class="${r.failed?'fail':'pass'}">${r.failed?'FAIL':'✓'} · ${r.rmseState.toFixed(3)}</td>`;}

html+='</tr>';}

html+='</tbody>';$('matrix').innerHTML=html;
 }

 function statePayload(){return {controller:$('controller').value,observer:$('observer').value,scenario:$('scenario').value,t:plant.steps*L.DT,goal:plant.goal,truth:plant.s.slice(),estimate:lastEstimate.slice(),measurement:lastMeasurement.slice(),innovation:lastInnovation.slice(),force:lastForce,P:observer.P?observer.P.map(r=>r.slice()):null,rmse:Math.sqrt(sumErr/Math.max(1,nErr)),running};}

 async function registerWebMCP(){
   const mc=document.modelContext||navigator.modelContext;

if(!mc?.registerTool){$('webmcpBadge').textContent='WebMCP unavailable · UI 정상';$('webmcpBadge').classList.add('warn');

return;}

   const ac=new AbortController();window.__controlLabWebMCPAbort=ac;
   const reg=async tool=>mc.registerTool(tool,{signal:ac.signal});
   const ro={readOnlyHint:true,untrustedContentHint:false},rw={readOnlyHint:false,untrustedContentHint:false};

   try{
    await reg({name:'cartpole_get_state',description:'Read the current CartPole truth/effectively-visible educational lab state, selected controller/observer, estimator covariance and innovation.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:ro,execute:async()=>JSON.stringify(statePayload())});
    await reg({name:'cartpole_set_controller',description:'Select the controller in the CartPole lab.',inputSchema:{type:'object',properties:{controller:{type:'string',enum:['pid','lqr','mpc','ppo']}},required:['controller'],additionalProperties:false},annotations:rw,execute:async({controller:c})=>{$('controller').value=c;rebuild();

return 'controller='+c;}});
    await reg({name:'cartpole_set_observer',description:'Select the observer in the CartPole lab.',inputSchema:{type:'object',properties:{observer:{type:'string',enum:['truth','raw','kf','ekf','so2','residual','adaptive']}},required:['observer'],additionalProperties:false},annotations:rw,execute:async({observer:o})=>{$('observer').value=o;rebuild();

return 'observer='+o;}});
    await reg({name:'cartpole_set_scenario',description:'Select nominal, sensor-noise, model-mismatch, mixed, or measurement-glitch scenario.',inputSchema:{type:'object',properties:{scenario:{type:'string',enum:['nominal','sensor','model','mixed','glitch']}},required:['scenario'],additionalProperties:false},annotations:rw,execute:async({scenario:s})=>{$('scenario').value=s;rebuild();

return 'scenario='+s;}});
    await reg({name:'cartpole_apply_push',description:'Apply a short external cart force pulse.',inputSchema:{type:'object',properties:{force:{type:'number',minimum:-8,maximum:8},steps:{type:'integer',minimum:1,maximum:50}},required:['force'],additionalProperties:false},annotations:rw,execute:async({force,steps=10})=>{plant.applyPush(force,steps);

return `push ${force} N for ${steps} control steps`;}});
    await reg({name:'cartpole_reset',description:'Reset the current CartPole experiment using the selected controller, observer and scenario.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:rw,execute:async()=>{rebuild();

return 'reset';}});
    await reg({name:'cartpole_run_steps',description:'Advance a bounded number of control steps and return the resulting state and estimator metrics.',inputSchema:{type:'object',properties:{steps:{type:'integer',minimum:1,maximum:500}},required:['steps'],additionalProperties:false},annotations:rw,execute:async({steps})=>{for(let i=0;i<steps;i++)stepOne();renderAll();

return JSON.stringify(statePayload());}});
    await reg({name:'cartpole_run_probe',description:'Run a deterministic offline CartPole probe for one controller, observer and scenario without changing the live UI state.',inputSchema:{type:'object',properties:{controller:{type:'string',enum:['pid','lqr','mpc','ppo']},observer:{type:'string',enum:['truth','raw','kf','ekf','so2','residual','adaptive']},scenario:{type:'string',enum:['nominal','sensor','model','mixed','glitch']},seed:{type:'integer',minimum:1,maximum:1000000},steps:{type:'integer',minimum:20,maximum:500},pushForce:{type:'number',minimum:-8,maximum:8}},required:['controller','observer','scenario'],additionalProperties:false},annotations:ro,execute:async({controller:c,observer:o,scenario:s,seed=77,steps=300,pushForce=3})=>JSON.stringify(L.runEpisode({controller:c,observer:o,scenario:s,seed,steps,goal:+$('goal').value,actor,residualModel,pushAt:Math.min(120,Math.floor(steps*.4)),pushForce}))});
    $('webmcpBadge').textContent='WebMCP tools registered';$('webmcpBadge').classList.add('ok');
   }catch(e){$('webmcpBadge').textContent='WebMCP registration failed';$('webmcpBadge').classList.add('warn');console.warn(e);}
 }

 for(const id of ['controller','observer','scenario','goal'])$(id).addEventListener('change',rebuild);
 $('play').addEventListener('click',()=>{running=!running;renderMetrics();});$('step').addEventListener('click',()=>{running=false;stepOne();renderAll();});$('reset').addEventListener('click',rebuild);$('pushL').addEventListener('click',()=>plant.applyPush(-3,10));$('pushR').addEventListener('click',()=>plant.applyPush(3,10));$('compare').addEventListener('click',compare);
 rebuild();registerWebMCP();requestAnimationFrame(loop);
})();
