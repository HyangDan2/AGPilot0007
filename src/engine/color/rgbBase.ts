import {RGBBaseSettings,RGB_PRIMARIES,HSL} from '../../types/colorMixer';

export function hasRGBBaseEdits(base:RGBBaseSettings):boolean {
 return base.enabled&&(base.shadowsTint!==0||RGB_PRIMARIES.some(c=>base.primaries[c].hue!==0||base.primaries[c].saturation!==0));
}
// Rotate each RGB basis vector about the neutral axis, then preserve its white response.
// Column-major matrix, shared by CPU reference and WebGL. This is not a RAW camera profile.
export function buildRGBBaseMatrix(base:RGBBaseSettings):Float32Array {
 const matrix=new Float32Array([1,0,0,0,1,0,0,0,1]);
 if(!base.enabled)return matrix;
 RGB_PRIMARIES.forEach((c,col)=>{
  const angle=base.primaries[c].hue/100*Math.PI/6,cos=Math.cos(angle),sin=Math.sin(angle),scale=1+base.primaries[c].saturation/200;
  const v=[0,1,2].map(row=>(row===col?1:0)-1/3);
  const cross=[v[2]-v[1],v[0]-v[2],v[1]-v[0]].map(x=>x/Math.sqrt(3));
  for(let row=0;row<3;row++)matrix[col*3+row]=1/3+scale*(v[row]*cos+cross[row]*sin);
 });
 for(let row=0;row<3;row++){
  const correction=(matrix[row]+matrix[3+row]+matrix[6+row]-1)/3;
  for(let col=0;col<3;col++)matrix[col*3+row]-=correction;
 }
 // Preserve luminance as well as neutral response; column errors sum to zero.
 const weights=[.2126,.7152,.0722];
 for(let col=0;col<3;col++){
  const error=weights.reduce((sum,w,row)=>sum+w*matrix[col*3+row],0)-weights[col];
  for(let row=0;row<3;row++)matrix[col*3+row]-=error;
 }
 return matrix;
}
export function applyRGBBase(linear:HSL,base:RGBBaseSettings):HSL {
 if(!hasRGBBaseEdits(base))return [...linear];
 const m=buildRGBBaseMatrix(base);
 let out=[0,1,2].map(row=>m[row]*linear[0]+m[3+row]*linear[1]+m[6+row]*linear[2]);
 const lum=Math.max(0,linear[0]*.2126+linear[1]*.7152+linear[2]*.0722);
 const t=Math.min(1,Math.max(0,lum/.25)),shadow=1-t*t*(3-2*t);
 const tint=base.shadowsTint/100*shadow*lum;
 out=out.map((v,i)=>v+tint*[.18,-.07167785,.18][i]);
 const y=Math.max(0,out[0]*.2126+out[1]*.7152+out[2]*.0722),low=Math.min(...out);
 if(low<0){const scale=y/Math.max(1e-7,y-low);out=out.map(v=>Math.max(0,y+(v-y)*scale));}
 return out as HSL;
}
export const RGB_BASE_SHADER=`
uniform bool u_rgb_base_enabled;
uniform mat3 u_rgb_base_matrix;
uniform float u_shadows_tint;
vec3 applyRGBBase(vec3 linear) {
 if(!u_rgb_base_enabled)return linear;
 vec3 result=u_rgb_base_matrix*linear;
 float lum=max(0.,dot(linear,vec3(.2126,.7152,.0722)));
 float shadow=1.-smoothstep(0.,.25,lum);
 result+=u_shadows_tint*shadow*lum*vec3(.18,-.07167785,.18);
 float y=max(0.,dot(result,vec3(.2126,.7152,.0722)));
 float low=min(result.r,min(result.g,result.b));
 if(low<0.)result=max(vec3(0.),y+(result-y)*(y/max(.0000001,y-low)));
 return result;
}
`;
