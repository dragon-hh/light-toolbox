import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function common(file,globals={}){const c={module:{exports:{}},...globals};vm.runInNewContext(readFileSync('miniprogram/'+file,'utf8'),c);return c.module.exports;}
const presentation=common('utils/presentation.js'),catalog=common('utils/catalog.js');
function environment() {
  const errors=[],requests=[],nav=[],scrolls=[];
  const wx={setNavigationBarTitle:()=>{},pageScrollTo:o=>scrolls.push(o),switchTab:o=>nav.push(o.url),showToast:()=>{}};
  const saved = new Map();
  wx.getStorageSync = key => saved.has(key) ? saved.get(key) : '';
  wx.setStorageSync = (key, value) => saved.set(key, structuredClone(value));
  wx.removeStorageSync = key => saved.delete(key);
  const consent=common('utils/processing-consent.js',{wx,console:{info:()=>{},error:()=>{}}});
  const session=common('utils/tool-session.js',{wx});
  const api={uuid:()=> 'test-stable-job',request:async()=>({mode:'verification',tools:catalog.map(t=>({id:t.id,available:true}))}),authed:async()=>({isMember:true,credits:0}),showError:e=>errors.push(e),upload:async(tool,paths,fields,id)=>{requests.push(id);return {jobId:id,tool,originalBytes:1000,outputBytes:500,savedPercent:50,artifact:{mime:'image/jpeg',jobId:id,expiresAt:Date.now()+3600000}};},download:async()=>'/download.jpg'};
  const actions={saveImage:async()=>{},openPdf:async()=>{},previewImage:async()=>{}};
  api.reportError=(e,context={})=>{errors.push(e);return {message:context.userMessage || e.message,diagnostic:e.requestId || ''};};
  function page(file='pages/tool/index.js') {
    let p;
    const deps={'../../utils/api':api,'../../utils/catalog':catalog,'../../utils/presentation':presentation,'../../utils/tool-session':session,'../../utils/file-actions':actions,'../../utils/processing-consent':consent,'../../utils/image-format':common('utils/image-format.js',{wx})};
    vm.runInNewContext(readFileSync('miniprogram/'+file,'utf8'),{Page:x=>{p=x;},require:n=>{if(!deps[n])throw new Error('Unexpected '+n);return deps[n];},wx,console:{info:()=>{},error:()=>{}}});
    p.setData=function(v,cb){Object.assign(this.data,v);if(cb)cb();};return p;
  }
  return {page,api,actions,wx,session,consent,errors,requests,nav,scrolls};
}
async function ready(h) {const p=h.page();await p.onLoad({id:'compress'});p.update({files:[{id:'f',path:'/test.jpg',size:1000}]});p.agree({detail:{value:['yes']}});return p;}

test('empty tool forms validate files first without uploading or consuming rights',async()=>{
 const h=environment(),p=h.page();await p.onLoad({id:'pdf'});await p.run();assert.match(h.errors[0].message,/至少两个 PDF/);assert.equal(h.requests.length,0);
});

test('PDF moves and removal change the submitted order before processing and stay locked while pending',async()=>{
 const h=environment(),p=h.page();await p.onLoad({id:'pdf'});p.update({files:[{id:'a',path:'/a.pdf'},{id:'b',path:'/b.pdf'},{id:'c',path:'/c.pdf'}]});p.agree({detail:{value:['yes']}});
 p.moveFile({currentTarget:{dataset:{index:1,direction:-1}}});p.removeFile({currentTarget:{dataset:{index:2}}});
 let paths;h.api.upload=async(tool,files)=>{paths=files;return {tool,files:2,pages:2,artifact:{mime:'application/pdf'}};};
 await p.run();assert.deepEqual(Array.from(paths),['/b.pdf','/a.pdf']);p.moveFile({currentTarget:{dataset:{index:0,direction:1}}});assert.equal(p.data.files[0].id,'b');
});
test('completed result is scrolled into view and a second run cannot create another paid task',async()=>{
 const h=environment(),p=await ready(h);await p.run();assert.equal(p.data.result.outputSize,'1 KB');assert.equal(h.scrolls[0].selector,'#tool-result');await p.run();assert.equal(h.requests.length,1);
 p.changeQuality({detail:{value:40}});assert.equal(p.data.quality,75);
 p.startOver();assert.equal(p.data.files.length,0);assert.equal(p.data.result,null);assert.equal(p.data.agreed,true);
});
test('preview download failure retains successful result and retries download only',async()=>{
 const h=environment();let downloads=0;h.api.download=async()=>{downloads++;throw new Error('network failed');};const p=await ready(h);await p.run();assert.ok(p.data.result);assert.equal(p.data.pending,false);assert.match(p.data.error,/不会重新处理/);
 h.api.download=async()=>{downloads++;return '/recovered.jpg';};await p.loadResultImage();assert.equal(p.data.resultPath,'/recovered.jpg');assert.equal(p.data.error,'');assert.equal(downloads,2);assert.equal(h.requests.length,1);
});
test('purchase tab round-trip restores selected files, options and consent within the session',async()=>{
 const h=environment(),p=await ready(h);p.changeQuality({detail:{value:60}});p.openMember();p.onUnload();assert.equal(h.nav[0],'/pages/member/index');assert.equal(h.session.getReturn().name,'图像压缩');
 const returned=h.page();await returned.onLoad({id:'compress'});assert.equal(returned.data.files[0].path,'/test.jpg');assert.equal(returned.data.quality,60);assert.equal(returned.data.agreed,true);
});

test('one persisted confirmation covers all file tools and revocation blocks a stale open page',async()=>{
 const h=environment(),p=await ready(h);
 for(const id of ['photo','pdf','compress']){const reopened=h.page();await reopened.onLoad({id});assert.equal(reopened.data.agreed,true);}
 h.consent.revoke();assert.equal(p.data.agreed,true);await p.run();assert.equal(p.data.agreed,false);assert.equal(h.requests.length,0);
 // Old per-tool session flags must never override the shared consent record.
 h.session.save('compress',{agreed:true,files:[]});const reopened=h.page();await reopened.onLoad({id:'compress'});assert.equal(reopened.data.agreed,false);
});

test('consent storage failures are visible and cannot authorize an upload',async()=>{
 const h=environment(),p=h.page();await p.onLoad({id:'compress'});p.update({files:[{path:'/test.jpg'}]});
 h.wx.setStorageSync=()=>{throw new Error('disk full');};p.agree({detail:{value:['yes']}});assert.equal(p.data.agreed,false);assert.match(p.data.consentError,/无法保存/);await p.run();assert.equal(h.requests.length,0);
 h.wx.getStorageSync=()=>{throw new Error('read failed');};await p.run();assert.match(p.data.consentError,/无法读取/);assert.equal(h.requests.length,0);
});
test('unknown server outcome locks inputs and reuses the request after page destruction',async()=>{
 const h=environment();let first=true;const normal=h.api.upload;
 h.api.upload=async(...args)=>{if(first){first=false;h.requests.push(args[3]);throw Object.assign(new Error('unknown commit'),{code:'INTERNAL'});}return normal(...args);};
 const p=await ready(h);await p.run();assert.equal(p.data.pending,true);p.startOver();p.changeQuality({detail:{value:30}});assert.equal(p.data.files.length,1);assert.equal(p.data.quality,75);p.onUnload();
 const returned=h.page();await returned.onLoad({id:'compress'});assert.equal(returned.data.pending,true);await returned.run();assert.deepEqual(h.requests,['test-stable-job','test-stable-job']);assert.equal(returned.data.pending,false);assert.ok(returned.data.result);
});
test('insufficient rights go to purchase before uploading and retain selected files',async()=>{
 const h=environment();h.api.authed=async()=>({isMember:false,credits:0});const p=await ready(h);await p.run();assert.equal(h.requests.length,0);assert.equal(h.nav[0],'/pages/member/index');assert.equal(h.session.load('compress').files.length,1);
});
test('saving twice while download/save is pending does not start duplicate work',async()=>{
 const h=environment(),p=await ready(h);await p.run();let release,calls=0;h.actions.saveImage=()=>{calls++;return new Promise(r=>{release=r;});};const saving=p.saveResult();await p.saveResult();assert.equal(calls,1);release();await saving;assert.equal(p.data.saving,false);
});
test('expired record is rejected at click time even if the displayed list was loaded earlier',async()=>{
 const h=environment();let downloads=0;h.api.download=async()=>{downloads++;};const p=h.page('pages/records/index.js');p.data.jobs=[{id:'old',tool:'compress',status:'succeeded',result:{artifact:{expiresAt:Date.now()-1}}}];await p.useResult({currentTarget:{dataset:{id:'old',action:'save'}}});assert.equal(downloads,0);assert.match(h.errors[0].message,/已不可用/);
});
test('record saving uses the native album action and retains diagnostic codes for support',async()=>{
 const h=environment();let saves=0,clipboard='';h.actions.saveImage=async()=>{saves++;};h.wx.setClipboardData=o=>{clipboard=o.data;};h.api.authed=async()=>[{id:'job-1',tool:'compress',status:'succeeded',created_at:Date.now(),finished_at:Date.now(),result:{artifact:{expiresAt:Date.now()+60000}}},{id:'job-2',tool:'photo',status:'failed',created_at:Date.now(),finished_at:Date.now(),error:'NO_PORTRAIT',result:null}];const p=h.page('pages/records/index.js');await p.load();assert.match(p.data.jobs[1].failureText,/人像/);assert.match(p.data.jobs[0].date,/年.*月.*日/);
 await p.useResult({currentTarget:{dataset:{id:'job-1',action:'save'}}});assert.equal(saves,1);p.copyDiagnostic({currentTarget:{dataset:{id:'job-2'}}});assert.match(clipboard,/NO_PORTRAIT/);assert.match(clipboard,/job-2/);
});
test('album privacy declaration errors never send users to phone permission settings',async()=>{
 const error={errMsg:'saveImageToPhotosAlbum:fail api scope is not declared in the privacy agreement'};let modal=false;
 const actions=common('utils/file-actions.js',{require:()=>({showError:()=>{}}),wx:{saveImageToPhotosAlbum:o=>o.fail(error),showModal:()=>{modal=true;}},console});
 await assert.rejects(actions.saveImage('/image.jpg'),e=>e===error);assert.equal(modal,false);
});
