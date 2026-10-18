import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

async function server(t) {
  const dataDir=mkdtempSync(path.join(tmpdir(),'light-test-'));
  const config=loadConfig({APP_MODE:'local',DATA_DIR:dataDir,LIGHT_PRICE_SINGLE_FEN:'100',LIGHT_PRICE_MONTH_FEN:'990'});const context=createApp(config);
  const http=context.app.listen(0,'127.0.0.1');await once(http,'listening');
  const base='http://127.0.0.1:'+http.address().port;
  t.after(async()=>{await new Promise(resolve=>http.close(resolve));context.store.close();rmSync(dataDir,{recursive:true,force:true});});
  const login=async()=>{const res=await fetch(base+'/api/auth/local',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:randomUUID()})});return (await res.json()).token;};
  return {...context,base,login};
}
test('anonymous requests denied; local mode cannot take payments',async t=>{
  const s=await server(t);assert.equal((await fetch(s.base+'/api/me')).status,401);
  const token=await s.login();const res=await fetch(s.base+'/api/orders',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({sku:'month',platform:'ios'})});
  assert.equal(res.status,503);assert.equal((await res.json()).error.code,'PAYMENT_NOT_CONFIGURED');
});
test('cross-origin local login is rejected',async t=>{
  const s=await server(t);const response=await fetch(s.base+'/api/auth/local',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:JSON.stringify({deviceId:randomUUID()})});assert.equal(response.status,403);
});
test('real PDF upload, private download, replay, and expiry work end to end',async t=>{
  const s=await server(t),token=await s.login(),other=await s.login(),id=randomUUID();
  const a=await PDFDocument.create();a.addPage([123,200]);const b=await PDFDocument.create();b.addPage([456,600]);
  function form(){const body=new FormData();body.append('files',new Blob([aBytes]),'a.pdf');body.append('files',new Blob([bBytes]),'b.pdf');return body;}
  const aBytes=await a.save(),bBytes=await b.save();
  const headers={Authorization:'Bearer '+token,'Idempotency-Key':id};
  const response=await fetch(s.base+'/api/tools/pdf',{method:'POST',headers,body:form()});assert.equal(response.status,200);const result=await response.json();assert.equal(result.pages,2);
  const replay=await fetch(s.base+'/api/tools/pdf',{method:'POST',headers,body:form()});assert.deepEqual(await replay.json(),result);
  assert.equal((await fetch(s.base+result.artifact.url)).status,401);
  assert.equal((await fetch(s.base+result.artifact.url,{headers:{Authorization:'Bearer '+other}})).status,404);
  const download=await fetch(s.base+result.artifact.url,{headers:{Authorization:'Bearer '+token}});assert.equal(download.status,200);
  const pdf=await PDFDocument.load(await download.arrayBuffer());assert.deepEqual(pdf.getPages().map(p=>p.getWidth()),[123,456]);
  s.store.now=()=>Date.now()+3600001;assert.equal((await fetch(s.base+result.artifact.url,{headers:{Authorization:'Bearer '+token}})).status,410);
  const expiredReplay=await fetch(s.base+'/api/tools/pdf',{method:'POST',headers,body:form()});
  assert.equal(expiredReplay.status,410);assert.equal((await expiredReplay.json()).error.code,'RESULT_EXPIRED');
  const expiredJobs=await (await fetch(s.base+'/api/jobs',{headers:{Authorization:'Bearer '+token}})).json();
  assert.equal(expiredJobs.find(job=>job.id===id).result,null);
  s.cleanup();assert.equal(s.store.db.prepare('SELECT count(*) n FROM artifacts').get().n,0);
  assert.equal(s.store.db.prepare('SELECT result FROM jobs WHERE id=?').get(id).result,null);
});
test('compression upload returns a real decodable image and recoverable job result',async t=>{
  const s=await server(t),token=await s.login();const source=await sharp({create:{width:500,height:400,channels:3,background:'#44AABB'}}).png().toBuffer();
  const body=new FormData();body.append('files',new Blob([source]),'source.png');body.append('quality','60');
  const response=await fetch(s.base+'/api/tools/compress',{method:'POST',headers:{Authorization:'Bearer '+token,'Idempotency-Key':randomUUID()},body});assert.equal(response.status,200);
  const result=await response.json();assert.ok(result.outputBytes<=source.length);
  const file=await fetch(s.base+result.artifact.url,{headers:{Authorization:'Bearer '+token}});assert.equal((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).width,500);
});
test('lottery errors are explicit, do not produce winners and are recorded as failed',async t=>{
  const s=await server(t),token=await s.login(),id=randomUUID();
  const response=await fetch(s.base+'/api/tools/lottery',{method:'POST',headers:{Authorization:'Bearer '+token,'Idempotency-Key':id,'content-type':'application/json'},body:JSON.stringify({title:'转盘',entries:[{id:'a',label:'A',weight:0},{id:'b',label:'B',weight:1}]})});
  assert.equal(response.status,400);assert.equal((await response.json()).error.code,'INVALID_WEIGHT');
  const jobs=await (await fetch(s.base+'/api/jobs',{headers:{Authorization:'Bearer '+token}})).json();assert.equal(jobs[0].status,'failed');assert.equal(jobs[0].result,null);
});
