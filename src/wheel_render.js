// The authoritative radius/width/inertia are sourced; hub/tread are a labelled
// display approximation. This Canvas renderer reads the bundled OBJ-equivalent mesh.
function renderWheelMesh(g,x,y,r,angle=0,oblique=.25){
 const vs=WHEEL_MESH.vertices.map(p=>{const c=Math.cos(angle),s=Math.sin(angle),u=p[0]*c-p[1]*s,v=p[0]*s+p[1]*c,z=p[2];return [x+(u+oblique*z)*r/.033,y-v*r/.033,z-oblique*u];});
 const colors={tire:'#29333d',rim:'#b5c1c9',hub:'#6e8291',tread:'#3d4b56'};
 const fs=WHEEL_MESH.faces.map((f,i)=>({f,i,z:f.reduce((a,k)=>a+vs[k][2],0)/f.length})).sort((a,b)=>a.z-b.z);
 for(const {f,i} of fs){g.beginPath();f.forEach((k,j)=>j?g.lineTo(vs[k][0],vs[k][1]):g.moveTo(vs[k][0],vs[k][1]));g.closePath();g.fillStyle=colors[WHEEL_MESH.groups[i]];g.fill();}
 // Hub screw highlights: display-only detail, no invented mass properties.
 g.save();g.translate(x,y);g.rotate(-angle);for(let j=0;j<6;j++){const a=j*Math.PI/3;g.fillStyle='#344957';g.beginPath();g.arc(.53*r*Math.cos(a),.53*r*Math.sin(a),Math.max(.7,r*.04),0,2*Math.PI);g.fill();}g.restore();
}
