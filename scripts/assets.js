import { mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
const names=['scan-face','dices','files','minimize-2','sparkles','arrow-up-right','arrow-right','upload','check','folder-open','x','chevron-left','shield-check'];
mkdirSync('miniprogram/assets',{recursive:true});
for(const name of names) {
  const svg=readFileSync(`node_modules/lucide-static/icons/${name}.svg`,'utf8').replaceAll('currentColor','#30392B');
  await sharp(Buffer.from(svg)).resize(192,192).png().toFile(`miniprogram/assets/${name}.png`);
}
console.log(`Generated ${names.length} local Lucide PNG icons (ISC license).`);
