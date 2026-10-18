'use strict';
const fs=require('fs'),path=require('path'),Lab=require('../src/control_lab_engine');
const actor=JSON.parse(fs.readFileSync(path.join(__dirname,'..','src','example_robust.json'),'utf8')).records.at(-1).policy.actor;
const residual=JSON.parse(fs.readFileSync(path.join(__dirname,'..','artifacts','control_observer_residual.json'),'utf8'));
const controllers=['pid','lqr','mpc','ppo'],observers=['truth','raw','kf','ekf','so2','residual','adaptive'],scenarios=['nominal','sensor','model','mixed','glitch'],seeds=[1,2,3,4,5];
const out={schema:'cartpole-control-observer-evaluation/v1',steps:300,push:{at:120,force:3,steps:10},seeds,rows:[]};
for(const scenario of scenarios)for(const controller of controllers)for(const observer of observers){
 const rs=seeds.map(seed=>Lab.runEpisode({controller,observer,scenario,seed,steps:300,actor,residualModel:residual,pushAt:120,pushForce:3}));
 out.rows.push({scenario,controller,observer,failures:rs.filter(r=>r.failed).length,meanStateRmse:rs.reduce((s,r)=>s+r.rmseState,0)/rs.length,meanMaxAngleDeg:rs.reduce((s,r)=>s+r.maxAngle,0)/rs.length*180/Math.PI});
}
out.residualArtifact=residual.metrics;
const dest=path.join(__dirname,'..','validation','control_observer_metrics.json');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(out,null,2));console.log(dest,out.rows.length);
