self.onmessage=async(event:MessageEvent<File>)=>{
 let bitmap:ImageBitmap|undefined;
 try{bitmap=await createImageBitmap(event.data,{resizeWidth:192,resizeQuality:'low',imageOrientation:'from-image'});const scale=Math.min(192/bitmap.width,128/bitmap.height),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d')!.drawImage(bitmap,0,0,w,h);const blob=await canvas.convertToBlob({type:'image/jpeg',quality:.7});self.postMessage({blob});}
 catch{self.postMessage({error:true});}finally{bitmap?.close();}
};
