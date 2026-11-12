import { DateStampSettings, isValidStampDate } from '../../types/camera';

// Original seven-segment geometry. No external font or font network request.
const DIGITS: Record<string, string> = { '0':'abcdef', '1':'bc', '2':'abdeg', '3':'abcdg', '4':'bcfg', '5':'acdfg', '6':'acdefg', '7':'abc', '8':'abcdefg', '9':'abcdfg' };
export function formatStampDate(settings: Pick<DateStampSettings,'date'|'format'>): string {
  if (!isValidStampDate(settings.date)) return '';
  const [y,m,d] = settings.date.split('-');
  return settings.format === 'full' ? `${y} ${m} ${d}` : settings.format === 'padded' ? `${y.slice(-2)} ${m} ${d}` : `'${y.slice(-2)} ${Number(m)} ${Number(d)}`;
}
export function stampLayout(width: number, height: number, settings: DateStampSettings) {
  const text = formatStampDate(settings);
  const digitHeight = Math.min(width,height) * settings.size / 100;
  const advance = (ch: string) => digitHeight * (ch === ' ' ? .36 : ch === "'" ? .24 : .72);
  const textWidth = [...text].reduce((n,ch)=>n+advance(ch),0);
  const padding = Math.ceil(digitHeight*.65);
  const patchWidth = Math.ceil(textWidth+padding*2), patchHeight = Math.ceil(digitHeight+padding*2);
  const margin = Math.min(width,height)*.045;
  return { text, digitHeight, padding, width:patchWidth, height:patchHeight,
    x: settings.position === 'bottom-left' ? margin-padding : width-margin-textWidth-padding,
    y: height-margin-digitHeight-padding, advance };
}
function drawDigit(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, h: number) {
  if (ch === "'") { ctx.fillRect(x+h*.08,y,h*.1,h*.24); return; }
  const segments = DIGITS[ch]; if (!segments) return;
  const w=h*.52, t=h*.11;
  const bars: Record<string,number[]> = { a:[x+t,y,w-t,t], b:[x+w,y+t,t,h*.5-t], c:[x+w,y+h*.5,t,h*.5-t], d:[x+t,y+h-t,w-t,t], e:[x,y+h*.5,t,h*.5-t], f:[x,y+t,t,h*.5-t], g:[x+t,y+h*.5-t*.5,w-t,t] };
  for(const key of segments) { const [bx,by,bw,bh]=bars[key]; ctx.fillRect(bx,by,bw,bh); }
}
export function createDateStamp(width: number, height: number, settings: DateStampSettings) {
  if (!settings.enabled || !isValidStampDate(settings.date)) return null;
  const layout=stampLayout(width,height,settings);
  const canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Date imprint canvas unavailable');
  ctx.fillStyle=settings.color;ctx.globalAlpha=settings.opacity/100;
  const draw=()=>{let x=layout.padding;for(const ch of layout.text){drawDigit(ctx,ch,x,layout.padding,layout.digitHeight);x+=layout.advance(ch);}};
  // Blur radius and halo scale with the image, including full resolution exports.
  if(settings.glow>0){ctx.shadowColor=settings.color;ctx.shadowBlur=layout.digitHeight*.45*settings.glow/100;draw();}
  ctx.shadowBlur=0;ctx.globalAlpha=settings.opacity/100*.8;
  ctx.filter=`blur(${Math.max(.15,layout.digitHeight*.018)}px)`;draw();ctx.filter='none';
  return {canvas,layout};
}
