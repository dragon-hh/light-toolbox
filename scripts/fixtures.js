import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
const dir='output/fixtures';mkdirSync(dir,{recursive:true});
for(let i=1;i<=2;i++) {
  const pdf=await PDFDocument.create(),page=pdf.addPage([595,842]),font=await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({x:0,y:0,width:595,height:842,color:i===1?rgb(.87,.91,.83):rgb(.96,.87,.77)});
  page.drawText(`LIGHT / DOCUMENT ${i}`,{x:55,y:700,size:29,font,color:rgb(.16,.2,.12)});
  page.drawText(`Source page ${i}`,{x:55,y:650,size:17,font,color:rgb(.4,.45,.3)});
  writeFileSync(`${dir}/document-${i}.pdf`,await pdf.save());
}
const width=1400,height=1000,buffer=Buffer.alloc(width*height*3);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*3;buffer[i]=Math.round(90+x/width*130);buffer[i+1]=Math.round(120+y/height*100);buffer[i+2]=Math.round(80+(Math.sin(x/21+y/18)+1)*50);
}
await sharp(buffer,{raw:{width,height,channels:3}}).png().toFile(`${dir}/compression-sample.png`);
console.log('Created synthetic PDFs and image fixtures (no personal data).');
