'use strict';
const fs=require('fs'),path=require('path');
const Core=require('../src/core'),Lab=require('../src/control_lab_engine');
const OUT=path.join(__dirname,'..','artifacts','control_observer_residual.json');
function features(inn,prev,u,base,y){return [inn[0],inn[1],prev[0],prev[1],u/10,base[1]/3,base[2]/.25,base[3]/3,y[0]/2.4,y[1]/.25];}
function collect(seed0,count,scenarios){
 const rows=[];
 for(let e=0;e<count;e++){
  const scenario=scenarios[e%scenarios.length],plant=new Lab.LabPlant({seed:seed0+e,scenario}),obs=new Lab.SO2Observer(plant.spec),ctl=new Lab.LQRController(plant.spec);
  const y0=plant.sensor();obs.reset(y0);ctl.reset();let u=0,prev=[0,0];
  for(let k=0;k<320;k++){
   const truth=plant.s.slice(),y=plant.sensor(),base=obs.step(y,u,truth),inn=obs.last.innovation.slice();
   if(k===90+(e%5)*5)plant.applyPush((e%2?1:-1)*(2.5+(e%3)),10);
   const f=features(inn,prev,u,base,y),target=[truth[0]-base[0],truth[1]-base[1],Lab.wrap(truth[2]-base[2]),truth[3]-base[3]];
   if(k>8&&!target.some(v=>!Number.isFinite(v))&&Math.abs(truth[2])<.5)rows.push({f,t:target});
   u=ctl.act(base,0);const out=plant.step(u);if(out.failed)break;prev=inn;
  }
 }
 return rows;
}
function stats(rows,key,n){
 const mean=Array(n).fill(0),std=Array(n).fill(0);for(const r of rows)for(let i=0;i<n;i++)mean[i]+=r[key][i];for(let i=0;i<n;i++)mean[i]/=rows.length;for(const r of rows)for(let i=0;i<n;i++)std[i]+=(r[key][i]-mean[i])**2;for(let i=0;i<n;i++)std[i]=Math.sqrt(std[i]/rows.length)+1e-9;return {mean,std};
}
function evalRows(model,rows,xs,ys){
 let base=0,net=0;
 for(const r of rows){
  const x=r.f.map((v,i)=>(v-xs.mean[i])/xs.std[i]),y=r.t.map((v,i)=>(v-ys.mean[i])/ys.std[i]),pred=model.forward(x).y;
  for(let i=0;i<4;i++){const p=pred[i]*ys.std[i]+ys.mean[i];base+=r.t[i]*r.t[i];net+=(r.t[i]-p)**2;}
 }
 return {baseRmse:Math.sqrt(base/(rows.length*4)),residualRmse:Math.sqrt(net/(rows.length*4))};
}
const trainRows=collect(1000,52,['model','mixed','sensor','nominal']);
const valRows=collect(9000,14,['model','mixed','sensor','nominal']);
const xs=stats(trainRows,'f',10),ys=stats(trainRows,'t',4);
const rng=new Core.RNG(4242),m=new Core.MLP(rng,10,16,4,.03);
const order=Array.from({length:trainRows.length},(_,i)=>i),batch=128;
for(let epoch=0;epoch<45;epoch++){
 for(let i=order.length-1;i>0;i--){const j=Math.floor(rng.uniform()*(i+1)),t=order[i];order[i]=order[j];order[j]=t;}
 for(let s=0;s<order.length;s+=batch){
  const G=new Float64Array(m.p.length),end=Math.min(order.length,s+batch),scale=1/(end-s);
  for(let kk=s;kk<end;kk++){const r=trainRows[order[kk]],x=r.f.map((v,i)=>(v-xs.mean[i])/xs.std[i]),y=r.t.map((v,i)=>(v-ys.mean[i])/ys.std[i]),f=m.forward(x),dy=f.y.map((v,i)=>2*(v-y[i]));m.backward(f,dy,G,scale);}
  m.adam(G,.0015,2.0);
 }
 if(epoch%10===0||epoch===44){const e=evalRows(m,valRows,xs,ys);console.log('epoch',epoch,e);}
}
const snap=m.snapshot(),w1=Array.from({length:16},(_,i)=>Array.from(snap.p.slice(i*10,(i+1)*10))),b1=Array.from(snap.p.slice(160,176)),w2=Array.from({length:4},(_,i)=>Array.from(snap.p.slice(176+i*16,176+(i+1)*16))),b2=Array.from(snap.p.slice(240,244));
const metrics=evalRows(m,valRows,xs,ys);
const artifact={schema:'cartpole-control-observer-residual/v1',kind:'InNKF-style educational residual MLP',input:['innovation_x','innovation_theta','prev_innovation_x','prev_innovation_theta','u_div_10','vhat_div_3','theta_hat_div_.25','omega_hat_div_3','measurement_x_div_2.4','measurement_theta_div_.25'],output:['dx','dv','dtheta','domega'],trainEpisodes:52,validationEpisodes:14,trainSamples:trainRows.length,validationSamples:valRows.length,trainScenarios:['model','mixed','sensor','nominal'],validationSeeds:'9000..9013',mean:xs.mean,std:xs.std,outMean:ys.mean,outStd:ys.std,w1,b1,w2,b2,metrics};
fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(artifact,null,2));console.log('wrote',OUT,metrics);
