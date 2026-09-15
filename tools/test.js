'use strict';
// A small test runner instead of a runtime dependency or framework.
const {spawnSync}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'evidence'),{recursive:true});
for(const file of ['test_public_contract.js','test_bam.js','test_lesson.js','test_integration.js','test_tip.js','test_robust_v2.js']){
 const r=spawnSync(process.execPath,[path.join(root,'tests',file)],{cwd:root,stdio:'inherit'});
 if(r.error)throw r.error;
 if(r.status!==0)process.exit(r.status||1);
}
console.log('All engine/contract suites passed. Browser tests are separate.');
