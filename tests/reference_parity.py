"""Independent numpy evaluation of pinned BAM M6 and motor torque equations.
The formulas are adapted from Rhoban/BAM model.py & actuator.py (Apache-2.0),
commit e9a619d56da5236206f4de6ceec2c1ee1b497b5c. This is equation parity, not
validation of the local wheel coupling, hardware, or BAM's MuJoCo runtime.
"""
import json,subprocess
from pathlib import Path
import numpy as np
root=Path(__file__).parents[1]
rng=np.random.default_rng(917)
rows=[]
for actuator in ['xl330','mx64','mx106']:
 p=json.loads((root/'vendor/bam/params'/f'{actuator}.json').read_text())
 m=rng.uniform(-3,3,1000);e=rng.uniform(-3,3,1000);v=rng.uniform(-15,15,1000);V=rng.uniform(-5,5,1000)
 sc=np.exp(-np.abs(v/p['dtheta_stribeck'])**p['alpha'])
 friction=p['friction_base']+np.abs(e*p['load_friction_external']-m*p['load_friction_motor'])
 friction+=sc*(p['friction_stribeck']+np.abs(e*p['load_friction_external_stribeck']-m*p['load_friction_motor_stribeck']))
 quad=np.where(np.abs(e)<np.abs(m),p['load_friction_external_quad']*np.abs(e)**2,np.where(np.abs(e)>np.abs(m),p['load_friction_motor_quad']*np.abs(m)**2,0))
 friction+=sc*quad*(np.sign(e)!=np.sign(m))
 torque=p['kt']*V/p['R']-p['kt']**2*v/p['R']
 for i in range(1000):rows.append([actuator,float(m[i]),float(e[i]),float(v[i]),float(V[i]),float(friction[i]),float(torque[i])])
code="""const P=require('./src/plant'),fs=require('fs');let rows=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(rows.map(([k,m,e,v,V])=>[P.frictionM6(P.ACTUATORS[k],m,e,v).frictionloss,P.motorTorque(P.ACTUATORS[k],V,v)])));"""
js=json.loads(subprocess.check_output(['node','-e',code],input=json.dumps(rows).encode(),cwd=root))
ref=np.array([r[5:] for r in rows]);error=np.max(np.abs(np.array(js)-ref),axis=0)
assert np.all(error<1e-12),error
report={'cases':len(rows),'sourceCommit':'e9a619d56da5236206f4de6ceec2c1ee1b497b5c','maxAbsoluteFrictionError':float(error[0]),'maxAbsoluteTorqueError':float(error[1]),'scope':'equations only; no hardware/MuJoCo parity claim'}
(root/'evidence/reference_parity.json').write_text(json.dumps(report,indent=2))
print(report)
