import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('native privacy declaration failures preserve diagnostics without directing users to phone settings',()=>{
  const modals=[],logs=[];
  const context={wx:{showModal:opts=>modals.push(opts)},console:{error:(...args)=>logs.push(args)},module:{exports:{}},require:()=>({mode:'local'})};
  vm.runInNewContext(readFileSync('miniprogram/utils/api.js','utf8'),context);
  const raw='chooseMedia:fail api scope is not declared in the privacy agreement';
  context.module.exports.showError({errMsg:raw,errno:112});
  assert.match(modals[0].content,/隐私声明尚未配置完成/);
  assert.doesNotMatch(modals[0].content,/设置中允许|重新授权/);
  assert.equal(logs[0][1].code,'PRIVACY_DECLARATION_MISSING');
  assert.equal(logs[0][1].message,raw);assert.equal(logs[0][1].platformErrno,112);
  context.module.exports.showError({errMsg:'chooseMedia:fail auth deny'});
  assert.equal(modals[1].content,'chooseMedia:fail auth deny');
});

test('clipboard declaration failure identifies copying and preserves diagnostic context',()=>{
  const modals=[],logs=[];
  const context={wx:{showModal:opts=>modals.push(opts)},console:{error:(...args)=>logs.push(args)},module:{exports:{}},require:()=>({mode:'local'})};
  vm.runInNewContext(readFileSync('miniprogram/utils/api.js','utf8'),context);
  const raw='setClipboardData:fail api scope is not declared in the privacy agreement';
  context.module.exports.showError({errMsg:raw,errno:112},{operation:'records.copyDiagnostic',jobId:'finished-job'});
  assert.equal(modals[0].title,'暂时无法复制');assert.match(modals[0].content,/剪贴板/);
  assert.equal(logs[0][1].operation,'records.copyDiagnostic');assert.equal(logs[0][1].jobId,'finished-job');assert.equal(logs[0][1].platformErrno,112);assert.equal(logs[0][1].message,raw);
  context.module.exports.showError({errMsg:raw,errno:112},{operation:'member.copyOrder',orderId:'order-1'});
  assert.equal(modals[1].title,'暂时无法复制');assert.doesNotMatch(modals[1].content,/抽奖/);assert.equal(logs[1][1].orderId,'order-1');
});

for(const method of ['lottery','upload'])test(`native ${method} clears expired credentials and logs in on the next explicit retry`,async()=>{
  const storage=new Map([['light.token','expired-token']]),calls=[];
  const wx={
    getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),
    getDeviceInfo:()=>({platform:'devtools'}),
    getFileSystemManager:()=>({readFile:options=>options.success({data:new ArrayBuffer(8)})}),
    request(options){
      calls.push(options.url);
      if(options.url.endsWith('/api/auth/local'))options.success({statusCode:200,data:{token:'fresh-token'}});
      else if(options.header.Authorization==='Bearer expired-token')options.success({statusCode:401,data:{error:{code:'UNAUTHORIZED',message:'Expired',requestId:'trace-test'}}});
      else options.success({statusCode:200,data:{jobId:'test-job'}});
    }
  };
  const context={wx,module:{exports:{}},require:()=>({mode:'local',apiBase:'http://127.0.0.1:8787'})};
  vm.runInNewContext(readFileSync('miniprogram/utils/api.js','utf8'),context);
  const api=context.module.exports,run=()=>method==='lottery'?api.lottery([{id:'a',label:'A',weight:1},{id:'b',label:'B',weight:1}],'转盘','test-job'):api.upload('compress',['synthetic.png'],{quality:75},'test-job');
  await assert.rejects(run(),error=>error.code==='UNAUTHORIZED' && error.requestId==='trace-test');
  assert.equal(storage.has('light.token'),false);assert.equal(calls.length,1);
  assert.equal((await run()).jobId,'test-job');assert.ok(calls[1].endsWith('/api/auth/local'));assert.equal(storage.get('light.token'),'fresh-token');
});
test('native cloud adapter preserves traced errors and obtains a fresh payment code',async()=>{
  const calls=[];let fail=false;
  const wx={login:opts=>opts.success({code:'fresh-code'}),cloud:{callFunction:async options=>{calls.push(options);return {result:fail?{ok:false,error:{code:'PAYMENT_REQUIRED',message:'需要次数',requestId:'cloud-trace'}}:{ok:true,data:{orderId:'new-order'}}};}}};
  const context={wx,module:{exports:{}},require:()=>({cloudFunction:'lightToolbox',cloudEnv:'verified-env'})};
  vm.runInNewContext(readFileSync('miniprogram/utils/cloud-api.js','utf8'),context);
  assert.equal((await context.module.exports.request('/api/orders','POST',{sku:'single'})).orderId,'new-order');
  assert.equal(calls[0].data.data.code,'fresh-code');assert.equal(calls[0].name,'lightToolbox');
  fail=true;await assert.rejects(context.module.exports.request('/api/me'),e=>e.code==='PAYMENT_REQUIRED' && e.requestId==='cloud-trace');
});

test('native private result download checks the job then uses wx.cloud.downloadFile',async()=>{
  const calls=[];
  const wx={cloud:{callFunction:async input=>{calls.push(input.data);return {result:{ok:true,data:{fileID:'cloud://verified/private.jpg'}}};},downloadFile:async input=>{calls.push(input);return {tempFilePath:'wxfile://private.jpg'};}}};
  const context={wx,module:{exports:{}},require:()=>({cloudFunction:'lightToolbox'})};
  vm.runInNewContext(readFileSync('miniprogram/utils/cloud-api.js','utf8'),context);
  assert.equal(await context.module.exports.download({jobId:'job'}),'wxfile://private.jpg');
  assert.equal(calls[0].data.jobId,'job');assert.equal(calls[1].fileID,'cloud://verified/private.jpg');
});
