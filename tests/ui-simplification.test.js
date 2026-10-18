import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

function common(path, globals = {}) {
  const context = { module: { exports: {} }, ...globals };
  vm.runInNewContext(readFileSync('miniprogram/' + path, 'utf8'), context);
  return context.module.exports;
}
const imageFormat = common('utils/image-format.js');
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('compression format hint matches server alpha metadata for real JPEG, PNG and WebP containers', async () => {
  for (const alpha of [undefined, 1, 0.4]) {
    for (const format of ['jpeg', 'png', 'palette', 'webp', 'lossless']) {
      const source = sharp({ create: { width: 48, height: 32, channels: alpha === undefined ? 3 : 4, background: { r: 20, g: 170, b: 50, alpha: alpha === undefined ? 1 : alpha } } });
      const bytes = await (format === 'palette' ? source.png({palette:true}) : format === 'lossless' ? source.webp({lossless:true}) : source[format]()).toBuffer();
      const metadata = await sharp(bytes).metadata();
      assert.equal(imageFormat.inspect(arrayBuffer(bytes)), metadata.hasAlpha ? 'WebP · 保留透明通道' : 'JPG', format + '/' + alpha);
    }
  }
});

test('unsupported or truncated images and read failures do not fabricate an output hint', async () => {
  const png = await sharp({create:{width:4,height:4,channels:4,background:'#00FF0080'}}).png().toBuffer();
  for (const bytes of [Buffer.from('not an image'),png.subarray(0,35)]) assert.throws(() => imageFormat.inspect(arrayBuffer(bytes)), e => e.code === 'IMAGE_FORMAT');
  const api = common('utils/image-format.js', {wx:{getFileSystemManager:()=>({readFile:o=>o.fail({errMsg:'read failed'})})}});
  await assert.rejects(api.forFile('private-path'), e => e.errMsg === 'read failed');
});

test('inline failures log once and keep trace data separate from the primary message', () => {
  const logs = [], modals = [];
  const api = common('utils/api.js', { require:()=>({mode:'local'}),console:{error:(...args)=>logs.push(args)},wx:{showModal:o=>modals.push(o)} });
  const error = Object.assign(new Error('网络中断，请重试'),{code:'NETWORK',requestId:'trace-1'});
  const info = api.reportError(error,{operation:'tool.run',jobId:'job-1'});
  assert.equal(logs.length,1);assert.equal(modals.length,0);assert.equal(info.message,error.message);
  assert.match(info.diagnostic,/trace-1/);assert.match(info.diagnostic,/job-1/);
  api.showError(error);
  assert.equal(modals.length,1);assert.doesNotMatch(modals[0].content,/trace-1/);
  modals[0].success({confirm:true});assert.equal(modals.length,2);assert.match(modals[1].content,/trace-1/);
});

test('inline payment failure preserves the purchase return target', () => {
  let component, target, retried = 0;
  vm.runInNewContext(readFileSync('miniprogram/components/error-notice/index.js','utf8'),{Component:c=>{component=c;},require:()=>({openMember:value=>{target=value;}})});
  const context = { data:{disabled:false,info:{returnTo:{url:'/pages/wheel/index',name:'幸运转盘'}}},triggerEvent:()=>{retried++;} };
  component.methods.purchase.call(context);assert.equal(target.url,'/pages/wheel/index');
  component.methods.retry.call(context);context.data.disabled=true;component.methods.retry.call(context);assert.equal(retried,1);
});

test('home refresh waits for actual rights and prevents stale requests from replacing newer profile', async () => {
  const pricing = common('utils/pricing.js'), catalog = common('utils/catalog.js');
  let page, resolveOld, fail = false, calls = 0;
  const api = {config:{mode:'verification'},request:async()=>({mode:'verification',prices:{single:{price:100},month:{price:110}}}),
    authed:()=>{calls++;if(calls===1)return new Promise(resolve=>{resolveOld=resolve;});if(fail)throw new Error('rights unavailable');return Promise.resolve({isMember:true,credits:0});},reportError:e=>({message:e.message})};
  const deps={'../../utils/api':api,'../../utils/pricing':pricing,'../../utils/catalog':catalog};
  vm.runInNewContext(readFileSync('miniprogram/pages/home/index.js','utf8'),{Page:p=>{page=p;},require:path=>deps[path]});
  page.setData=patch=>Object.assign(page.data,patch);
  const old=page.loadPrices();assert.equal(page.data.profile,null);
  await page.loadPrices();assert.equal(page.data.profile.isMember,true);
  resolveOld({isMember:false,credits:3});await old;assert.equal(page.data.profile.isMember,true);
  fail=true;await page.loadPrices();assert.equal(page.data.profile,null);assert.equal(page.data.prices,null);assert.match(page.data.error,/rights unavailable/);
});

test('lottery history uses view expiry while downloadable files use save expiry', () => {
  const presentation = common('utils/presentation.js');
  assert.equal(presentation.expiryLabel(120000,60000,'lottery'),'还可查看约 1 分钟');
  assert.equal(presentation.expiryLabel(120000,60000,'photo'),'还可保存约 1 分钟');
  assert.equal(presentation.expiryLabel(60000,120000,'lottery'),'结果已过期');
});
