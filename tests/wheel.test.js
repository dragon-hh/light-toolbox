import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function common(file, globals={}) { const context={module:{exports:{}},...globals};vm.runInNewContext(readFileSync(file,'utf8'),context);return context.module.exports; }
const wheel=common('miniprogram/utils/wheel.js');
test('wheel landing stays in the winning sector after repeated spins for every supported size',()=>{
  for(let n=2;n<=8;n++){
    let rotation=0;
    for(let turn=0;turn<20;turn++)for(let index=0;index<n;index++){
      const next=wheel.landingAngle(rotation,index,n);assert.ok(next-rotation>=2160);
      const center=(next+index*360/n)%360;assert.ok(Math.min(center,360-center)<1e-7);
      rotation=next;
    }
  }
});
test('wheel requires a picture and description, and never uploads local images or paths',()=>{
  const draft=clone(wheel.defaults());draft.entries[0].image='wxfile://private-photo.jpg';draft.entries[0].weight=10;
  const equal=wheel.payload(draft);assert.equal(equal.entries[0].weight,1);assert.doesNotMatch(JSON.stringify(equal),/wxfile|image/);
  draft.weighted=true;assert.equal(wheel.payload(draft).entries[0].weight,10);
  draft.entries[1].image='';assert.throws(()=>wheel.payload(draft),/选择图片/);
  draft.entries[1].image='/image.png';draft.entries[1].label=' ';assert.throws(()=>wheel.payload(draft),/文字描述/);
});
function harness(shared={value:null}, lottery) {
  let page,calls=0,id=0;const errors=[];
  const wx={pageScrollTo:()=>{}};
  wx.getStorageSync=()=>shared.consent || '';
  wx.setStorageSync=(_key,value)=>{shared.consent=clone(value);};
  wx.removeStorageSync=()=>{shared.consent=null;};
  const consent=common('miniprogram/utils/processing-consent.js',{wx,console:{info:()=>{},error:()=>{}}});
  consent.accept();
  const storage={load:()=>clone(shared.value),save:value=>{if(shared.fail)throw new Error('disk full');shared.value=clone({...value,version:1});}};
  const api={request:async()=>({mode:'development',tools:[{id:'lottery',available:true}]}),authed:async()=>({isMember:true,credits:0}),uuid:()=>`job-${++id}`,showError:e=>errors.push(e),reportError:e=>{errors.push(e);return {message:e.message};},lottery:async(...args)=>{calls++;return lottery(...args);}};
  vm.runInNewContext(readFileSync('miniprogram/pages/wheel/index.js','utf8'),{Page:p=>{page=p;},require:path=>path.endsWith('/api')?api:path.endsWith('/wheel')?wheel:path.endsWith('/wheel-storage')?storage:path.endsWith('/processing-consent')?consent:{render:async()=>'/render.png'},wx,console:{info:()=>{},error:()=>{}},setTimeout:()=>1,clearTimeout:()=>{}});
  page.data=clone(page.data);page.setData=function(patch,cb){Object.assign(this.data,clone(patch));if(cb)cb();};
  page.onLoad();
  if(!shared.value){storage.save({draft:wheel.defaults(),pending:null,last:null});page.saved=clone(shared.value);}
  page.setData({stage:'spin',ready:true,available:true});
  return {page,errors,calls:()=>calls,shared,wx,consent};
}
function result(entries,title,jobId){return {version:2,tool:'lottery',title,jobId,entryCount:entries.length,winnerIndex:1,winner:{id:entries[1].id,label:entries[1].label},winners:[entries[1].label]};}

test('wheel reads shared consent and cannot submit from stale state after revocation',async()=>{
 const h=harness({value:null},async()=>{throw new Error('must not draw');});assert.equal(h.page.data.agreed,true);
 h.consent.revoke();await h.page.spin();assert.equal(h.page.data.agreed,false);assert.equal(h.calls(),0);assert.equal(h.shared.value.pending,null);
 h.page.agree({detail:{value:['yes']}});assert.equal(h.consent.isAccepted(),true);
});
test('lost response survives restart and reuses the same job before revealing one server result',async()=>{
  const shared={value:null};let firstId;
  const first=harness(shared,async(entries,title,jobId)=>{firstId=jobId;throw new Error('network interrupted');});
  await first.page.spin();assert.equal(first.page.data.pending,true);assert.equal(first.page.data.busy,false);assert.equal(shared.value.pending.jobId,firstId);
  const second=harness(shared,async(entries,title,jobId)=>{assert.equal(jobId,firstId);return result(entries,title,jobId);});
  await second.page.spin();assert.equal(second.page.data.result,null);assert.equal(second.page.data.busy,true);assert.equal(second.shared.value.pending,null);
  await second.page.spin();assert.equal(second.calls(),1);
  second.page.reveal();assert.equal(second.page.data.result.winnerIndex,1);assert.equal(second.page.data.busy,false);
  const reopened=harness(shared,async()=>{throw new Error('must not draw again');});assert.equal(reopened.page.data.result.jobId,firstId);assert.equal(reopened.calls(),0);
});
test('unpersistable requests never reach the server; mismatched outcomes never animate or clear pending',async()=>{
  const first=harness({value:null},async()=>{throw new Error('must not send');});first.shared.fail=true;
  await first.page.spin();assert.equal(first.calls(),0);assert.match(first.errors[0].message,/disk full/);
  const second=harness({value:null},async(entries,title,jobId)=>({...result(entries,title,jobId),winnerIndex:0}));
  await second.page.spin();assert.equal(second.page.data.rotation,0);assert.equal(second.page.data.result,null);assert.equal(second.page.data.pending,true);assert.match(second.errors[0].message,/不一致/);
});

test('cancel editing restores the saved options and recent result without another draw',async()=>{
  const draft=clone(wheel.defaults()), last={result:result(draft.entries,draft.title,'prior-job'),at:Date.now()};
  const shared={value:{draft,pending:null,last}}, before=clone(shared.value);
  const h=harness(shared,async()=>{throw new Error('must not draw again');});
  h.page.edit();h.page.changeTitle({detail:{value:'unsaved title'}});
  h.page.changeLabel({currentTarget:{dataset:{index:0}},detail:{value:'unsaved option'}});
  await h.page.cancelEdit();
  assert.equal(h.page.data.stage,'spin');assert.equal(h.page.data.title,draft.title);
  assert.equal(h.page.data.entries[0].label,draft.entries[0].label);assert.equal(h.page.data.result.jobId,'prior-job');
  assert.equal(h.page.data.ready,true);assert.equal(h.calls(),0);assert.deepEqual(shared.value,before);
  h.page.edit();h.page.saved.last.at=Date.now()-3600001;await h.page.cancelEdit();assert.equal(h.page.data.result,null);
});

test('local cleanup only removes obsolete files from its own directory, and propagates write failures',async()=>{
  const removed=[],root='/user/light-wheel';let fail=false;
  const fs={readdir:o=>o.success({files:o.dirPath==='/user'?['light-wheel']:['keep.img','old.img']}),unlink:o=>{removed.push(o.filePath);o.success({});},copyFile:o=>o.fail({errMsg:'disk full'})};
  const storage=common('miniprogram/utils/wheel-storage.js',{wx:{env:{USER_DATA_PATH:'/user'},getFileSystemManager:()=>fs,setStorageSync:()=>{if(fail)throw new Error('write rejected');}}});
  await storage.cleanup([{image:root+'/keep.img'}]);assert.deepEqual(removed,[root+'/old.img']);
  await assert.rejects(storage.importImage('/tmp/photo','new-id'),e=>e.errMsg==='disk full');
  fail=true;assert.throws(()=>storage.save({draft:{}}),/write rejected/);
});
