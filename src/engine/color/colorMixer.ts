import {ColorMixerSettings,HSL,MIXER_COLORS,PointColor,hasColorMixerEdits} from '../../types/colorMixer';
export const MIXER_CENTERS=[0,30,60,120,180,240,270,300].map(v=>v/360);
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function rgbToHsl(rgb:HSL):HSL {
  const [r,g,b]=rgb, max=Math.max(...rgb),min=Math.min(...rgb),d=max-min,l=(max+min)/2;
  if(d<1e-7)return [0,0,l];
  let h=max===r?(g-b)/d:max===g?(b-r)/d+2:(r-g)/d+4;
  h=((h/6)%1+1)%1;
  return [h,d/Math.max(1e-7,1-Math.abs(2*l-1)),l];
}
// Standard six-sector hue triangle; explicit version mirrors GLSL.
export function hslToRgb(hsl:HSL):HSL {
 const [h,s,l]=hsl,c=(1-Math.abs(2*l-1))*s;
 const hue=(offset:number)=>clamp(Math.abs((((h+offset)%1+1)%1)*6-3)-1);
 return [0,2/3,1/3].map(o=>(hue(o)-.5)*c+l) as HSL;
}
export function mixerBandWeights(h:number):number[] {
 h=((h%1)+1)%1;const weights=Array(8).fill(0);
 for(let i=0;i<8;i++){const start=MIXER_CENTERS[i],end=i===7?1:MIXER_CENTERS[i+1];if(h>=start&&h<=end){const t=smooth(start,end,h);weights[i]=1-t;weights[(i+1)%8]=t;break;}}
 return weights;
}
export function pointColorWeight(hsl:HSL,p:PointColor):number {
 const dh=Math.abs(hsl[0]-p.color[0]);
 const distances=[Math.min(dh,1-dh),Math.abs(hsl[1]-p.color[1]),Math.abs(hsl[2]-p.color[2])];
 const widths=[p.range.hue/360,p.range.saturation/100,p.range.luminance/100];
 return distances.reduce((w,d,i)=>w*(1-smooth(Math.max(0,widths[i]*(1-p.feather/100)),widths[i],d)),1);
}
export function applyColorMixer(rgb:HSL,mixer:ColorMixerSettings):HSL {
 if(!hasColorMixerEdits(mixer))return [...rgb];
 const ref=rgbToHsl(rgb),weights=mixerBandWeights(ref[0]);const delta=[0,0,0];
 MIXER_COLORS.forEach((c,i)=>{const p=mixer.bands[c];delta[0]+=weights[i]*p.hue/100/12;delta[1]+=weights[i]*p.saturation/100;delta[2]+=weights[i]*p.luminance/100;});
 const pd=[0,0,0];let total=0;
 mixer.points.forEach(p=>{if(!p.enabled)return;const w=pointColorWeight(ref,p);total+=w;pd[0]+=w*p.shift.hue/200;pd[1]+=w*p.shift.saturation/100;pd[2]+=w*p.shift.luminance/100;});
 const chroma=Math.max(...rgb)-Math.min(...rgb),guard=smooth(.005,.04,chroma);
 for(let i=0;i<3;i++)delta[i]=(delta[i]+pd[i]/Math.max(1,total))*guard;
 const h=((ref[0]+delta[0])%1+1)%1,s=clamp(ref[1]+Math.min(1,Math.max(-1,delta[1]))*(delta[1]>=0?1-ref[1]:ref[1])),l=clamp(ref[2]+Math.min(1,Math.max(-1,delta[2]))*.65*(delta[2]>=0?1-ref[2]:ref[2]));
 return hslToRgb([h,s,l]);
}
export function pointFromColor(rgb:HSL,index:number):PointColor {
 return {id:`color-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name:`Color ${index+1}`,color:rgbToHsl(rgb),enabled:true,shift:{hue:0,saturation:0,luminance:0},range:{hue:25,saturation:35,luminance:35},feather:50};
}
export const MIXER_SHADER=`
uniform bool u_mixer_enabled;
uniform bool u_mixer_reference;
uniform vec3 u_mix_bands[8];
uniform int u_point_count;
uniform vec3 u_point_color[8];
uniform vec4 u_point_range[8];
uniform vec4 u_point_shift[8];
uniform int u_mixer_visualize;
vec3 rgbHsl(vec3 c) {
 float hi=max(c.r,max(c.g,c.b)),lo=min(c.r,min(c.g,c.b)),d=hi-lo,l=(hi+lo)*.5;
 if(d<.0000001)return vec3(0.,0.,l);
 float h=hi==c.r?(c.g-c.b)/d:hi==c.g?(c.b-c.r)/d+2.:(c.r-c.g)/d+4.;
 return vec3(fract(h/6.+1.),d/max(.0000001,1.-abs(2.*l-1.)),l);
}
vec3 hslRgb(vec3 c) {
 vec3 hue=clamp(abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.);
 return c.z+(hue-.5)*(1.-abs(2.*c.z-1.))*c.y;
}
float pointWeight(vec3 ref, int i) {
 vec3 d=abs(ref-u_point_color[i]);d.x=min(d.x,1.-d.x);
 vec3 width=u_point_range[i].xyz;
 vec3 w=1.-smoothstep(max(vec3(0.),width*(1.-u_point_range[i].w)),width,d);
 return w.x*w.y*w.z;
}
vec3 mixColors(vec3 rgb) {
 if(!u_mixer_enabled && u_mixer_visualize<0)return rgb;
 vec3 bounded=clamp(rgb,0.,1.),ref=rgbHsl(bounded),delta=vec3(0.);
 float centers[8]=float[8](0.,1./12.,1./6.,1./3.,.5,2./3.,.75,5./6.);
 for(int i=0;i<8;i++){float end=i==7?1.:centers[i+1];if(ref.x>=centers[i]&&ref.x<=end){float t=smoothstep(centers[i],end,ref.x);delta=mix(u_mix_bands[i],u_mix_bands[(i+1)%8],t);break;}}
 vec3 pd=vec3(0.);float total=0.;
 for(int i=0;i<8;i++){if(i>=u_point_count)break;if(u_point_shift[i].w<.5&&u_mixer_visualize!=i)continue;float w=pointWeight(ref,i);if(u_mixer_visualize==i)return mix(vec3(dot(bounded,vec3(.2126,.7152,.0722))*.2),bounded,w);if(u_point_shift[i].w>.5){pd+=u_point_shift[i].xyz*w;total+=w;}}
 if(!u_mixer_enabled)return rgb;
 delta=(delta+pd/max(1.,total))*smoothstep(.005,.04,max(bounded.r,max(bounded.g,bounded.b))-min(bounded.r,min(bounded.g,bounded.b)));
 vec3 adjusted=vec3(fract(ref.x+delta.x+1.),clamp(ref.y+clamp(delta.y,-1.,1.)*(delta.y>=0.?1.-ref.y:ref.y),0.,1.),clamp(ref.z+clamp(delta.z,-1.,1.)*.65*(delta.z>=0.?1.-ref.z:ref.z),0.,1.));
 return hslRgb(adjusted);
}
`;
