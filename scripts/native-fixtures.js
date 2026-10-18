// Test-only fixtures for the official DevTools automator. No personal files are used.
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
const source=readFileSync('output/fixtures/compression-sample.png');
const bytes=await sharp(source).resize(240,160).png().toBuffer();
const name='/native-compress.png';
// The IDE bridge rejects large JSON bodies. Seed the synthetic file in bounded chunks.
const chunks=[];
for(let offset=0;offset<bytes.length;offset+=16000) {
  const filename=`native-image-${chunks.length}.json`;
  writeFileSync('output/fixtures/'+filename,JSON.stringify([{name,base64:bytes.subarray(offset,offset+16000).toString('base64'),first:offset===0}]));
  chunks.push(filename);
}
writeFileSync('output/fixtures/native-image-chunks.json',JSON.stringify(chunks));
writeFileSync('output/fixtures/choose-image.json',JSON.stringify({tempFiles:[{tempFilePath:'http://usr'+name,size:bytes.length,fileType:'image'}],type:'image',errMsg:'chooseMedia:ok'}));
console.log(`Synthetic native compression fixture: ${bytes.length} bytes.`);
