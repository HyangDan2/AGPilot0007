export interface SharpeningSettings { amount:number;radius:number;detail:number;masking:number;mode:'advanced'|'legacy' }
export const DEFAULT_SHARPENING:SharpeningSettings={amount:0,radius:1,detail:25,masking:0,mode:'advanced'};
export const SHARPENING_FIELDS=[{key:'amount',label:'Amount',min:0,max:150,step:1},{key:'radius',label:'Radius',min:.5,max:3,step:.1},{key:'detail',label:'Detail',min:0,max:100,step:1},{key:'masking',label:'Masking',min:0,max:100,step:1}] as const;
export function normalizeSharpening(value?:Partial<SharpeningSettings>|null,legacy=0):SharpeningSettings {const result={...DEFAULT_SHARPENING};if(!value&&legacy>0)return{...result,amount:Math.min(100,legacy),mode:'legacy'};result.mode=value?.mode==='legacy'?'legacy':'advanced';for(const field of SHARPENING_FIELDS){const n=value?.[field.key];result[field.key]=typeof n==='number'&&Number.isFinite(n)?Math.min(field.max,Math.max(field.min,n)):DEFAULT_SHARPENING[field.key];}return result;}
export function validateSharpening(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid sharpening');const v=value as SharpeningSettings;if(v.mode!==undefined&&v.mode!=='legacy'&&v.mode!=='advanced')throw Error('Invalid sharpening mode');for(const f of SHARPENING_FIELDS){const n=v[f.key];if(n!==undefined&&(!Number.isFinite(n)||n<f.min||n>f.max))throw Error('Invalid sharpening value');}}

export function sharpeningPreviewSize(width:number,height:number,displayWidth:number,displayHeight:number,zoom:number,draft:boolean){
 const limit=draft?Math.min(768,Math.max(384,Math.max(displayWidth,displayHeight)*zoom)):Math.max(width,height);
 const scale=Math.min(1,limit/Math.max(width,height));return{width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
