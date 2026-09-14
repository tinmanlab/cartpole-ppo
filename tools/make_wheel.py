from pathlib import Path
import math,json
p=Path(__file__).resolve().parents[1]
# Collision radius, width and inertia sourced from ROBOTIS URDF. The display
# mesh is explicitly a lightweight reconstruction, not the downloaded STL.
vs=[];faces=[];groups=[]
def tube(r0,r1,z0,z1,n,group):
    base=len(vs)
    for z,r in [(z0,r0),(z0,r1),(z1,r0),(z1,r1)]:
        for i in range(n):
            a=2*math.pi*i/n;vs.append([r*math.cos(a),r*math.sin(a),z])
    for i in range(n):
        j=(i+1)%n
        for face in [[i,j,n+j,n+i],[2*n+i,3*n+i,3*n+j,2*n+j],[n+i,n+j,3*n+j,3*n+i],[i,2*n+i,2*n+j,j]]:
            faces.append([base+k for k in face]);groups.append(group)
tube(.023,.033,-.009,.009,64,'tire');tube(.009,.024,-.006,.006,48,'rim');tube(.002,.010,-.011,.011,32,'hub')
# Radial ribs on tire exterior, decorative only; not used as contact mesh.
for i in range(48):
    a=2*math.pi*i/48;pts=[]
    for z in [-.0085,.0085]:
        for b,r in [(a,.0327),(a+.022,.0327),(a+.022,.033),(a,.033)]:pts.append([r*math.cos(b),r*math.sin(b),z])
    b=len(vs);vs+=pts
    for face in [[0,1,5,4],[2,3,7,6],[0,4,7,3],[1,2,6,5]]:faces.append([b+k for k in face]);groups.append('tread')
obj=['# Source dimensions: ROBOTIS TurtleBot3 Burger wheel URDF.', '# Display reconstruction; not original STL; visual hub/tread are illustrative.','mtllib wheel.mtl']
for v in vs:obj.append('v '+' '.join(f'{x:.8f}' for x in v))
old=None
for f,g in zip(faces,groups):
    if g!=old:obj.append('usemtl '+g);old=g
    obj.append('f '+' '.join(str(x+1) for x in f))
(p/'assets/wheel.obj').write_text('\n'.join(obj)+'\n')
(p/'assets/wheel.mtl').write_text('newmtl tire\nKd 0.12 0.15 0.18\nnewmtl rim\nKd 0.62 0.68 0.73\nnewmtl hub\nKd 0.35 0.43 0.50\nnewmtl tread\nKd 0.22 0.25 0.28\n')
(p/'src/wheel_data.js').write_text('const WHEEL_MESH='+json.dumps({'vertices':vs,'faces':faces,'groups':groups},separators=(',',':'))+';')
(p/'assets/wheel_source_excerpt.urdf').write_text('''<?xml version="1.0"?>
<!-- Excerpt adapted from ROBOTIS TurtleBot3 Burger URDF; Apache-2.0.
  source blob 5b1470e40ee3431475ecd85fbd4294c36933cb40.
  Original visual mesh reference retained for attribution, NOT bundled. -->
<robot name="turtlebot3_wheel_reference"><link name="wheel">
 <visual><origin xyz="0 0 0" rpy="1.57 0 0"/><geometry><mesh filename="package://turtlebot3_description/meshes/wheels/left_tire.stl" scale="0.001 0.001 0.001"/></geometry></visual>
 <collision><geometry><cylinder length="0.018" radius="0.033"/></geometry></collision>
 <inertial><mass value="2.8498940e-02"/><inertia ixx="1.1175580e-05" ixy="-4.2369783e-11" ixz="-5.9381719e-09" iyy="1.1192413e-05" iyz="-1.4400107e-11" izz="2.0712558e-05"/></inertial>
</link></robot>''')
print(len(vs),'vertices',len(faces),'faces')
