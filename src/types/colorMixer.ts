export const MIXER_COLORS = ['red','orange','yellow','green','aqua','blue','purple','magenta'] as const;
export const MIXER_AXES = ['hue','saturation','luminance'] as const;
export type MixerColor = typeof MIXER_COLORS[number];
export type MixerAxis = typeof MIXER_AXES[number];
export type HSL = [number,number,number];
export interface HSLShift { hue:number; saturation:number; luminance:number }
export interface PointColor {
  id:string; name:string; color:HSL; enabled:boolean;
  shift:HSLShift;
  range:HSLShift; // hue degrees, saturation/luminance percentages
  feather:number;
}
export const RGB_PRIMARIES = ['red','green','blue'] as const;
export type RGBPrimary = typeof RGB_PRIMARIES[number];
export interface RGBBaseSettings { enabled:boolean; shadowsTint:number; primaries:Record<RGBPrimary,{hue:number;saturation:number}> }
export const defaultRGBBase = ():RGBBaseSettings => ({enabled:true,shadowsTint:0,primaries:{red:{hue:0,saturation:0},green:{hue:0,saturation:0},blue:{hue:0,saturation:0}}});
export interface ColorMixerSettings { rgbBase:RGBBaseSettings; enabled:boolean; bands:Record<MixerColor,HSLShift>; points:PointColor[] }
export interface MixerUI {
  isColorMixerOpen:boolean;
  mixerTab:'mixer'|'point'|'base';
  mixerView:'color'|'component'|'all';
  mixerAxis:MixerAxis;
  mixerColor:MixerColor;
  mixerPointId:string|null;
  mixerTool:'none'|'target'|'eyedropper';
  mixerVisualize:boolean;
  mixerMessage:string;
}
export const zeroShift = ():HSLShift => ({hue:0,saturation:0,luminance:0});
export const defaultColorMixer = ():ColorMixerSettings => ({rgbBase:defaultRGBBase(),enabled:true,bands:Object.fromEntries(MIXER_COLORS.map(c=>[c,zeroShift()])) as Record<MixerColor,HSLShift>,points:[]});
const number=(value:unknown,fallback:number,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;
export function normalizeColorMixer(value?:Partial<ColorMixerSettings>|null):ColorMixerSettings {
  const out=defaultColorMixer();
  out.enabled=value?.enabled!==false;
  const base=value?.rgbBase;
  out.rgbBase.enabled=base?.enabled!==false;
  out.rgbBase.shadowsTint=number(base?.shadowsTint,0,-100,100);
  for(const c of RGB_PRIMARIES)for(const a of ['hue','saturation'] as const)out.rgbBase.primaries[c][a]=number(base?.primaries?.[c]?.[a],0,-100,100);
  for(const c of MIXER_COLORS) for(const axis of MIXER_AXES) out.bands[c][axis]=number(value?.bands?.[c]?.[axis],0,-100,100);
  const ids=new Set<string>();
  for(const [i,p] of (Array.isArray(value?.points)?value.points:[]).slice(0,8).entries()) {
    if(!p||!Array.isArray(p.color)||p.color.length!==3||!p.color.every(v=>Number.isFinite(v)&&v>=0&&v<=1))continue;
    const id=typeof p.id==='string'&&p.id.length>0?p.id.slice(0,100):`point-${i}`;
    if(ids.has(id))continue;ids.add(id);
    const shift=zeroShift();for(const a of MIXER_AXES)shift[a]=number(p.shift?.[a],0,-100,100);
    out.points.push({id,name:typeof p.name==='string'?p.name.slice(0,40):`Color ${i+1}`,color:[...p.color],enabled:p.enabled!==false,shift,range:{hue:number(p.range?.hue,25,1,180),saturation:number(p.range?.saturation,35,1,100),luminance:number(p.range?.luminance,35,1,100)},feather:number(p.feather,50,1,100)});
  }
  return out;
}
export function hasColorMixerEdits(value:ColorMixerSettings) {
  return value.enabled&&(MIXER_COLORS.some(c=>MIXER_AXES.some(a=>value.bands[c][a]!==0))||value.points.some(p=>p.enabled&&MIXER_AXES.some(a=>p.shift[a]!==0)));
}
export function validateColorMixer(value:unknown): void {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid color mixer');
  const v=value as ColorMixerSettings;
  if(v.rgbBase!==undefined){
    const b=v.rgbBase;
    if(!b||typeof b!=='object'||Array.isArray(b)||(b.enabled!==undefined&&typeof b.enabled!=='boolean'))throw Error('Invalid RGB Base');
    if(b.primaries!==undefined&&(!b.primaries||typeof b.primaries!=='object'||Array.isArray(b.primaries)))throw Error('Invalid RGB primaries');
    for(const c of RGB_PRIMARIES){const p=b.primaries?.[c];if(p!==undefined&&(!p||typeof p!=='object'||Array.isArray(p)))throw Error('Invalid RGB primary');for(const a of ['hue','saturation'] as const){const n=p?.[a];if(n!==undefined&&(!Number.isFinite(n)||n< -100||n>100))throw Error('Invalid RGB primary adjustment');}}
    if(b.shadowsTint!==undefined&&(!Number.isFinite(b.shadowsTint)||b.shadowsTint< -100||b.shadowsTint>100))throw Error('Invalid shadows tint');
  }
  if(v.enabled!==undefined&&typeof v.enabled!=='boolean')throw Error('Invalid mixer enabled value');
  if(v.bands!==undefined){if(!v.bands||typeof v.bands!=='object'||Array.isArray(v.bands))throw Error('Invalid mixer bands');for(const c of MIXER_COLORS)for(const a of MIXER_AXES){const n=v.bands[c]?.[a];if(n!==undefined&&(!Number.isFinite(n)||n< -100||n>100))throw Error('Invalid mixer adjustment');}}
  if(v.points!==undefined){if(!Array.isArray(v.points)||v.points.length>8)throw Error('Invalid point colors');const norm=normalizeColorMixer(v);if(norm.points.length!==v.points.length)throw Error('Invalid point color settings');
    for(const [i,p] of v.points.entries()) {
      if(p.id!==norm.points[i].id||typeof p.name!=='string'||p.name.length>40||(p.enabled!==undefined&&typeof p.enabled!=='boolean'))throw Error('Invalid point color identity');
      for(const a of MIXER_AXES){const n=p.shift?.[a];if(n!==undefined&&(!Number.isFinite(n)||n< -100||n>100))throw Error('Invalid point color shift');const r=p.range?.[a];if(r!==undefined&&(!Number.isFinite(r)||r<1||r>(a==='hue'?180:100)))throw Error('Invalid point color range');}
      if(p.feather!==undefined&&(!Number.isFinite(p.feather)||p.feather<1||p.feather>100))throw Error('Invalid point color feather');
    }}
}
