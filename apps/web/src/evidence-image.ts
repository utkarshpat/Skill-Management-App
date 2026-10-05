export async function compressEvidenceImage(file:File):Promise<Blob>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Choose JPEG, PNG or WebP, up to 10 MB.');
 const image=await createImageBitmap(file).catch(()=>{throw Error('This image could not be opened.');});
 try{if(image.width*image.height>50000000)throw Error('Image dimensions are too large.');const canvas=document.createElement('canvas');for(const size of [1920,1440,1080]){const ratio=Math.min(1,size/Math.max(image.width,image.height));canvas.width=Math.round(image.width*ratio);canvas.height=Math.round(image.height*ratio);canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Could not compress this image.')),'image/webp',.82));if(blob.size<=1048576)return blob;}throw Error('Image is too detailed to compress under 1 MB.');}finally{image.close();}
}
