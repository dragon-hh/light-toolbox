import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const target='cloudfunctions/lightToolbox';
mkdirSync(target+'/lib',{recursive:true});
for(const file of readdirSync('cloud').filter(name=>name.endsWith('.js'))) {
  writeFileSync(path.join(target,'lib',file),readFileSync(path.join('cloud',file),'utf8').replaceAll("'../server/","'./shared/"));
}
mkdirSync(target+'/lib/shared',{recursive:true});
for(const file of ['config.js','errors.js','tools.js','wechat.js'])copyFileSync('server/'+file,target+'/lib/shared/'+file);
writeFileSync(target+'/lib/package.json',JSON.stringify({type:'module'})+'\n');
writeFileSync(target+'/index.js',`const wxCloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');
wxCloud.init({env:wxCloud.DYNAMIC_CURRENT_ENV});
const app = tcb.init({env:tcb.SYMBOL_CURRENT_ENV,throwOnCode:true});
const cloud = {
  database:()=>app.database(), getWXContext:()=>wxCloud.getWXContext(),
  getUploadMetadata:options=>app.getUploadMetadata(options),
  getTempFileURL:options=>wxCloud.getTempFileURL(options),
  uploadFile:options=>wxCloud.uploadFile(options), deleteFile:options=>wxCloud.deleteFile(options)
};
let handler;
exports.main = async function(event) {
  if (!handler) handler = (await import('./lib/handler.js')).createHandler(cloud);
  return handler(event);
};
`);
const root=JSON.parse(readFileSync('package.json','utf8'));
writeFileSync(target+'/package.json',JSON.stringify({name:'light-toolbox-cloud',version:'0.1.0',private:true,main:'index.js',engines:{node:'>=20.19'},dependencies:{'wx-server-sdk':'4.0.2','@cloudbase/node-sdk':'3.18.7',sharp:root.dependencies.sharp,'pdf-lib':root.dependencies['pdf-lib'],'fast-xml-parser':root.dependencies['fast-xml-parser'],'tencentcloud-sdk-nodejs-bda':root.dependencies['tencentcloud-sdk-nodejs-bda']},overrides:{...root.overrides,'@cloudbase/node-sdk':'$@cloudbase/node-sdk','@cloudbase/database':'1.5.1',axios:'0.34.0'}},null,2)+'\n');
// Configure the authenticated timer separately; its secret must never enter
// the distributable code bundle or be reset by a routine deployment.
writeFileSync(target+'/config.json',JSON.stringify({permissions:{openapi:[]}},null,2)+'\n');
console.log('Built cloudfunctions/lightToolbox from cloud/ and shared server modules. No secrets copied.');
