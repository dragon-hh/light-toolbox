import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createCipheriv, createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { Store } from '../server/store.js';
import { loadConfig } from '../server/config.js';
import { paySignature, hmac, createPayData, verifyPushUrl, decryptPush, parseXml, WeChat } from '../server/wechat.js';
import { PaymentService } from '../server/payment-service.js';
import { drawLottery, compressImage, mergePdfs, makeIdPhoto } from '../server/tools.js';

const key=randomBytes(32).toString('hex');
test('Mini Program URL handshake echoes plaintext only after SHA1 signature and freshness checks',()=>{
  const config={pushToken:'syntheticToken'};
  const sign=query=>({...query,signature:createHash('sha1').update([config.pushToken,query.timestamp,query.nonce].sort().join('')).digest('hex')});
  const query=sign({timestamp:String(Math.floor(Date.now()/1000)),nonce:'nonce',echostr:'123456789'});
  assert.equal(verifyPushUrl(config,query),'123456789');
  assert.throws(()=>verifyPushUrl(config,{...query,signature:'0'.repeat(40)}),{code:'INVALID_SIGNATURE'});
  assert.throws(()=>verifyPushUrl(config,{...query,signature:query.signature+'junk'}),{code:'INVALID_SIGNATURE'});
  assert.throws(()=>verifyPushUrl(config,{...query,timestamp:['1']}),{code:'INVALID_SIGNATURE'});
  assert.throws(()=>verifyPushUrl(config,sign({...query,timestamp:'1'})),{code:'EXPIRED_SIGNATURE'});
  assert.throws(()=>verifyPushUrl(config,{...query,signature:undefined,msg_signature:query.signature}),{code:'INVALID_SIGNATURE'});
  assert.throws(()=>verifyPushUrl({pushToken:'a'.repeat(48)},query),{code:'PAYMENT_NOT_CONFIGURED'});
});
function database(t) { const store=new Store(':memory:',key);store.login('alice','secret');store.login('bob','other');t.after(()=>store.close());return store; }
function remote(order,overrides={}) {return {order_id:order.id,env_type:1,order_type:0,status:2,wx_order_id:'WX'+order.id,channel_order_id:'C'+order.id,paid_time:Math.floor(Date.now()/1000),order_fee:order.price,paid_fee:order.price,left_fee:order.price,...overrides};}
function paid(store,sku='single',user='alice') {const order=store.createOrder(user,sku,'product-'+sku,sku==='month'?990:100);return store.fulfill(order.id,remote(order),'test');}
test('WeChat official signature vectors match byte for byte',()=>{
  const body='{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}';
  assert.equal(paySignature('12345','/xpay/query_user_balance',body),'c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5');
  assert.equal(hmac('9hAb/NEYUlkaMBEsmFgzig==',body),'089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7');
});
test('payment signData is a string; price fixed at 100 fen and keys never returned',t=>{
  const store=database(t),order=store.createOrder('alice','single','single-id',100);
  const data=createPayData({offerId:'offer',appKey:'app-key'},order,'session-key');
  assert.equal(data.mode,'short_series_goods');assert.equal(JSON.parse(data.signData).goodsPrice,100);assert.equal(JSON.parse(data.signData).env,0);
  assert.equal(data.paySig,paySignature('app-key','requestVirtualPayment',data.signData));assert.ok(!JSON.stringify(data).includes('session-key'));
});
test('production fails startup on missing credentials and duplicate product IDs',()=>{
  assert.throws(()=>loadConfig({APP_MODE:'production'}),/Missing production/);
  assert.throws(()=>loadConfig({APP_MODE:'unexpected'}),/APP_MODE/);
  const config={APP_MODE:'production',WECHAT_APP_ID:'wx5492d17de04b205d',WECHAT_APP_SECRET:'test-only',XPAY_OFFER_ID:'test-only',XPAY_APP_KEY:'test-only',WECHAT_PUSH_TOKEN:'test-only',WECHAT_PUSH_AES_KEY:'a'.repeat(43),WECHAT_ORIGINAL_ID:'gh_test',SESSION_ENCRYPTION_KEY:key,XPAY_PRODUCT_SINGLE:'same',XPAY_PRODUCT_MONTH:'same'};
  assert.throws(()=>loadConfig(config),/own product ID/);
});
test('session keys are encrypted at rest; foreign/expired tokens fail',t=>{
  const store=database(t),token=store.login('alice','sensitive-session');const session=store.session(token);
  assert.ok(!session.secret.includes('sensitive-session'));assert.equal(store.unseal(session.secret),'sensitive-session');assert.equal(store.session('bad'),undefined);
  store.now=()=>Date.now()+8*86400000;assert.equal(store.session(token),undefined);
});
test('duplicate fulfillment grants exactly one credit',t=>{
  const store=database(t),order=paid(store);store.fulfill(order.id,remote(order),'repeat');assert.equal(store.profile('alice').credits,1);assert.equal(store.profile('bob').credits,0);
});
test('underpayment, wrong environment, wrong order and reused platform ID rejected',t=>{
  const store=database(t),first=paid(store),second=store.createOrder('alice','single','single-id',100);
  for(const wrong of [{paid_fee:1},{env_type:2},{order_id:'not-this-order'},{order_type:8},{wx_order_id:''},{wx_order_id:first.wx_id}]) {
    assert.throws(()=>store.fulfill(second.id,remote(second,wrong),'test'));
  }
  assert.equal(store.profile('alice').credits,1);
});
test('one credit cannot be reserved by two different jobs; failure releases it',t=>{
  const store=database(t);paid(store);const id=randomUUID();store.reserveJob('alice',id,'pdf','hash');
  assert.equal(store.profile('alice').credits,0);assert.throws(()=>store.reserveJob('alice',randomUUID(),'pdf','other'),/请先购买/);
  store.failJob(id,'INVALID_PDF');assert.equal(store.profile('alice').credits,1);
});
test('job replay returns original result without spending twice; payload/owner conflict rejected',t=>{
  const store=database(t);paid(store);const id=randomUUID(),result={jobId:id,winners:['Alice']};
  store.reserveJob('alice',id,'lottery','hash');store.succeedJob(id,result);
  assert.deepEqual(store.reserveJob('alice',id,'lottery','hash').result,result);
  assert.equal(store.profile('alice').credits,0);
  assert.throws(()=>store.reserveJob('alice',id,'lottery','changed'),/不同内容/);
  assert.throws(()=>store.reserveJob('bob',id,'lottery','hash'),/不同内容/);
});
test('month renewals stack; expiration enforced and refunds revoke the relevant grant',t=>{
  const store=database(t),single=paid(store),month=paid(store,'month');
  const end=store.memberUntil('alice');paid(store,'month');assert.equal(store.memberUntil('alice'),end+30*86400000);
  store.reserveJob('alice',randomUUID(),'pdf','hash');assert.equal(store.profile('alice').credits,1);
  store.refund(month.id,990,'refund');assert.equal(store.memberUntil('alice'),end);
  store.refund(single.id,100,'refund');assert.equal(store.profile('alice').credits,0);
  store.now=()=>end+1;assert.equal(store.profile('alice').isMember,false);
});
test('duplicate or late paid notifications cannot resurrect a refunded order',t=>{
  const store=database(t),order=paid(store);store.refund(order.id,100,'refund');store.refund(order.id,100,'refund-repeat');
  assert.throws(()=>store.fulfill(order.id,remote(order),'late'),/退款/);assert.equal(store.profile('alice').credits,0);
});
test('partial refund suspends only its entitlement and records review state',t=>{
  const store=database(t),order=paid(store);store.refund(order.id,50,'refund');assert.equal(store.order(order.id).status,'refund_review');assert.equal(store.profile('alice').credits,0);
});
test('interrupted jobs recover as failed and release reserved credit',t=>{
  const store=database(t);paid(store);store.reserveJob('alice',randomUUID(),'pdf','hash');assert.equal(store.recoverJobs(),1);assert.equal(store.profile('alice').credits,1);
});
test('delivery acknowledgment failure is observable; retry does not duplicate grant',async t=>{
  const store=database(t),order=store.createOrder('alice','single','single-id',100);let attempts=0;
  const service=new PaymentService(store,{query:async()=>remote(order),deliver:async()=>{if(++attempts===1)throw new Error('network timeout');}});
  await assert.rejects(service.sync(order,'test'),/network/);assert.equal(store.profile('alice').credits,1);assert.equal(store.order(order.id).delivered,0);
  await service.sync(store.order(order.id),'retry');assert.equal(store.profile('alice').credits,1);assert.equal(store.order(order.id).delivered,1);
});

test('reconciliation processes healthy orders but rejects when any order fails',async t=>{
  const store=database(t),bad=store.createOrder('alice','single','single-id',100),good=store.createOrder('bob','single','single-id',100);
  const service=new PaymentService(store,{query:async order=>{if(order.id===bad.id)throw new Error('upstream unavailable');return remote(order);},deliver:async()=>{}});
  await assert.rejects(service.reconcile(),AggregateError);
  assert.equal(store.profile('bob').credits,1);assert.equal(store.profile('alice').credits,0);
  assert.equal(store.db.prepare("SELECT count(*) n FROM events WHERE event='payment.reconcile_failed'").get().n,1);
  assert.equal(service.running,false);
});
test('query sends exact signed body and uses order_id, not out_trade_no',async()=>{
  const config={appId:'app',appSecret:'secret',appKey:'key'};let queryRequest;
  const wechat=new WeChat(config,async(url,options)=>{
    if(String(url).includes('stable_token'))return {ok:true,json:async()=>({access_token:'token',expires_in:7200})};
    queryRequest={url:new URL(url),options};return {ok:true,json:async()=>({errcode:0,order:{order_id:'business'}})};
  });
  await wechat.query({id:'business',user_id:'alice'});
  assert.deepEqual(JSON.parse(queryRequest.options.body),{openid:'alice',env:0,order_id:'business'});
  assert.equal(queryRequest.url.searchParams.get('pay_sig'),paySignature('key','/xpay/query_order',queryRequest.options.body));
});

test('delivery acknowledgement includes pay_sig over the exact HTTP body',async()=>{
  let request;
  const wechat=new WeChat({appId:'app',appSecret:'secret',appKey:'key'},async(url,options)=>{
    if(String(url).includes('stable_token'))return {ok:true,json:async()=>({access_token:'token',expires_in:7200})};
    request={url:new URL(url),options};return {ok:true,json:async()=>({errcode:0,errmsg:'ok'})};
  });
  await wechat.deliver({id:'business'},'delivery-test');
  assert.equal(request.url.pathname,'/xpay/notify_provide_goods');
  assert.deepEqual(JSON.parse(request.options.body),{order_id:'business',env:0});
  assert.equal(request.url.searchParams.get('pay_sig'),paySignature('key','/xpay/notify_provide_goods',request.options.body));
});
function encryptedMessage(config,text) {
  const key=Buffer.from(config.pushAesKey+'=','base64'),bytes=Buffer.from(text),length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);
  const content=Buffer.concat([randomBytes(16),length,bytes,Buffer.from(config.appId)]),pad=32-content.length%32;
  const cipher=createCipheriv('aes-256-cbc',key,key.subarray(0,16));cipher.setAutoPadding(false);
  const encrypted=Buffer.concat([cipher.update(Buffer.concat([content,Buffer.alloc(pad,pad)])),cipher.final()]).toString('base64');
  const query={timestamp:String(Math.floor(Date.now()/1000)),nonce:'nonce'};query.msg_signature=createHash('sha1').update([config.pushToken,query.timestamp,query.nonce,encrypted].sort().join('')).digest('hex');
  return {encrypted,query};
}
test('safe-mode push rejects forged signature and wrong app; large order numbers stay strings',()=>{
  const config={appId:'wx5492d17de04b205d',pushToken:'token',pushAesKey:randomBytes(32).toString('base64').slice(0,43)};
  const xml='<xml><OutTradeNo>12345678901234567890</OutTradeNo></xml>',msg=encryptedMessage(config,xml);
  assert.equal(parseXml(decryptPush(config,msg.query,msg.encrypted)).OutTradeNo,'12345678901234567890');
  assert.throws(()=>decryptPush(config,{...msg.query,msg_signature:'aa'},msg.encrypted),/签名错误/);
  assert.throws(()=>decryptPush({...config,appId:'another'},msg.query,msg.encrypted),/AppID/);
  assert.throws(()=>parseXml('<!DOCTYPE xml [<!ENTITY x "bad">]><xml/>'),/XML/);
});
test('wheel maps every integer ticket to exactly the declared weighted distribution',()=>{
  const entries=[{id:'a',label:'咖啡',weight:1},{id:'b',label:'电影',weight:3},{id:'c',label:'休息',weight:2}],counts=[0,0,0];
  for(let ticket=0;ticket<6;ticket++){
    const result=drawLottery(entries,'周末', (min,max)=>{assert.equal(min,0);assert.equal(max,6);return ticket;});
    counts[result.winnerIndex]++;assert.equal(result.winner.id,entries[result.winnerIndex].id);assert.deepEqual(result.winners,[result.winner.label]);
  }
  assert.deepEqual(counts,[1,3,2]);
  for(const weight of [0,-1,0.5,101,NaN,Infinity,'2'])assert.throws(()=>drawLottery([{...entries[0],weight},entries[1]],'周末'),{code:'INVALID_WEIGHT'});
  assert.throws(()=>drawLottery([entries[0],entries[0]],'周末'),{code:'DUPLICATE_ENTRIES'});
  assert.throws(()=>drawLottery([{...entries[0],label:'  '},entries[1]],'周末'),{code:'INVALID_ENTRIES'});
  assert.throws(()=>drawLottery(Array.from({length:9},(_,i)=>({...entries[0],id:String(i)})),'周末'),{code:'INVALID_ENTRIES'});
});
test('PDF merge preserves source order and rejects malformed/encrypted input',async()=>{
  const a=await PDFDocument.create();a.addPage([111,222]);const b=await PDFDocument.create();b.addPage([333,444]);
  const result=await mergePdfs([Buffer.from(await a.save()),Buffer.from(await b.save())]);
  const merged=await PDFDocument.load(result.buffer);assert.deepEqual(merged.getPages().map(p=>p.getWidth()),[111,333]);assert.equal(result.details.pages,2);
  await assert.rejects(mergePdfs([Buffer.from('not PDF'),Buffer.from(await a.save())]),/不是有效 PDF/);
});
test('compression yields a decodable image, never larger, and keeps transparency',async()=>{
  const pixels=Buffer.alloc(400*400*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=i%256;pixels[i+1]=Math.floor(i/400)%256;pixels[i+2]=120;pixels[i+3]=128;}
  const source=await sharp(pixels,{raw:{width:400,height:400,channels:4}}).png().toBuffer();
  const result=await compressImage(source,60);assert.ok(result.buffer.length<=source.length);assert.ok((await sharp(result.buffer).metadata()).hasAlpha);
  await assert.rejects(compressImage(Buffer.from('bad'),60),/无法读取/);
});
test('ID photo adapter produces expected dimensions, DPI and background; no unconfigured fallback',async()=>{
  const source=await sharp({create:{width:600,height:800,channels:3,background:'white'}}).png().toBuffer();
  const transparent=await sharp({create:{width:600,height:800,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  await assert.rejects(makeIdPhoto(source,'one','blue',null,'test'),/尚未开通/);
  const result=await makeIdPhoto(source,'one','blue',async()=>transparent,'test');
  const meta=await sharp(result.buffer).metadata();assert.equal(meta.width,295);assert.equal(meta.height,413);assert.equal(meta.density,300);
  const pixel=await sharp(result.buffer).raw().toBuffer();assert.ok(Math.abs(pixel[2]-219)<5);
});
