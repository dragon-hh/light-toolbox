import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { CloudStore, hash } from '../cloud/store.js';
import { createHandler } from '../cloud/handler.js';
import { CloudFiles } from '../cloud/files.js';
import { cloudConfig as loadCloudConfig, APP_ID, ENV_ID } from '../cloud/config.js';
import { CloudPayments } from '../cloud/payment.js';
import { WeChat, paySignature } from '../server/wechat.js';
import sharp from 'sharp';

// Transactional test double: commits a private copy atomically and serializes
// commits; non-transaction doc.get uses the real Node SDK array response shape.
class Database {
  constructor() {this.data=new Map();this.tail=Promise.resolve();this.command={gt:v=>({op:'gt',v})};}
  collection(name) {return this.surface(this.data,name,false);}
  surface(state,name,transaction) {
    const query=(condition={},sort=null,limit=100)=>({
      where:where=>query(where,sort,limit),orderBy:(field,direction)=>query(condition,{field,direction},limit),limit:n=>query(condition,sort,n),
      get:async()=>{
        let rows=[...state.entries()].filter(([k])=>k.startsWith(name+'/')).map(([,v])=>structuredClone(v));
        rows=rows.filter(row=>Object.entries(condition).every(([k,v])=>v?.op==='gt'?row[k]>v.v:row[k]===v));
        if(sort)rows.sort((a,b)=>(a[sort.field]<b[sort.field]?-1:a[sort.field]>b[sort.field]?1:0)*(sort.direction==='asc'?1:-1));
        return {data:rows.slice(0,limit)};
      },
      doc:id=>({
        get:async()=>{const row=state.get(name+'/'+id);return {data:transaction?(row?structuredClone(row):null):(row?[structuredClone(row)]:[])};},
        set:async(data)=>{state.set(name+'/'+id,{...structuredClone(data),_id:id});},
        update:async(data)=>{const row=state.get(name+'/'+id);if(!row)throw new Error('Missing document');state.set(name+'/'+id,{...row,...structuredClone(data)});},
        remove:async()=>state.delete(name+'/'+id)
      })
    });return query();
  }
  runTransaction(fn) {
    const next=this.tail.then(async()=>{const state=structuredClone(this.data);const result=await fn({collection:name=>this.surface(state,name,true)});this.data=state;return result;});
    this.tail=next.catch(()=>{});return next;
  }
}
const cloudConfig = env => loadCloudConfig({LIGHT_PRICE_SINGLE_FEN:'100',LIGHT_PRICE_MONTH_FEN:'990',...env});
const remote=(order,extra={})=>({order_id:order.id,env_type:1,order_type:0,status:2,order_fee:order.price,paid_fee:order.price,wx_order_id:'wx-'+order.id,paid_time:Math.floor(Date.now()/1000),...extra});
test('staged cloud callback verifies URL while payment events, orders and identity remain protected',async()=>{
  const config=cloudConfig({LIGHT_MODE:'development',LIGHT_TEST_OPENIDS:'alice',WECHAT_PUSH_TOKEN:'syntheticToken'});
  const handler=createHandler({getWXContext:()=>({})},{config,store:{},files:{}});
  const query={timestamp:String(Math.floor(Date.now()/1000)),nonce:'test',echostr:'hello'};
  query.signature=createHash('sha1').update([config.pushToken,query.timestamp,query.nonce].sort().join('')).digest('hex');
  const event={httpMethod:'GET',queryStringParameters:query};
  const response=await handler(event);assert.equal(response.statusCode,200);assert.equal(response.body,'hello');
  assert.equal((await handler({...event,queryStringParameters:{...query,signature:'0'.repeat(40)}})).statusCode,401);
  assert.equal((await handler({httpMethod:'POST',body:'<xml></xml>'})).statusCode,503);
  assert.equal((await handler({path:'/api/me'})).error.code,'UNAUTHORIZED');
  config.mode='closed';assert.equal((await handler(event)).statusCode,503);
});
async function paid(store,user='alice',sku='single') {const order=await store.createOrder(user,sku,'product-'+sku,sku==='month'?990:100);return store.fulfill(order.id,remote(order));}

async function notificationFixture(sku='single') {
  const store=new CloudStore(new Database()),order=await store.createOrder('alice',sku,'product-'+sku,sku==='month'?990:100);
  const config={...cloudConfig({LIGHT_MODE:'development',LIGHT_TEST_OPENIDS:'alice'}),mode:'verification',originalId:'gh_test'};
  const state={remote:remote(order,{left_fee:order.price}),queries:0,deliveries:0,deliveryError:null,queryError:null};
  const wechat={query:async()=>{state.queries++;if(state.queryError)throw state.queryError;return state.remote;},deliver:async()=>{state.deliveries++;if(state.deliveryError)throw state.deliveryError;}};
  const handler=createHandler({getWXContext:()=>({APPID:APP_ID,OPENID:'mallory',SOURCE:'client'})},{config,store,files:{},wechat});
  const goods={MsgType:'event',Event:'xpay_goods_deliver_notify',ToUserName:'gh_test',OpenId:'alice',OutTradeNo:order.id,Env:0,GoodsInfo:{ProductId:order.product_id,Quantity:1,OrigPrice:order.price,ActualPrice:order.price}};
  const refund={MsgType:'event',Event:'xpay_refund_notify',ToUserName:'gh_test',OpenId:'alice',MchOrderId:order.id,RetCode:0,RefundFee:order.price};
  return {store,order,config,state,wechat,handler,goods,refund};
}

test('native payment hints query WeChat, explicitly acknowledge delivery, and grant once across duplicates',async()=>{
  const {store,state,handler,goods}=await notificationFixture();
  assert.deepEqual(await handler(goods),{ErrCode:0,ErrMsg:'success'});
  assert.deepEqual(await handler(goods),{ErrCode:0,ErrMsg:'success'});
  assert.equal(state.queries,2);assert.equal(state.deliveries,1);
  assert.equal((await store.profile('alice')).credits,1);
});

test('forged native goods hints cannot grant unpaid orders or bypass recipient, owner, amount and allowlist',async()=>{
  const {store,order,state,config,handler,goods}=await notificationFixture();
  for(const event of [{...goods,ToUserName:'gh_other'},{...goods,OpenId:'bob'},{...goods,Env:1},{...goods,GoodsInfo:{...goods.GoodsInfo,ActualPrice:1}},{...goods,Event:'unknown'}])assert.equal((await handler(event)).ErrCode,1);
  assert.equal(state.queries,0);
  config.testers=['bob'];assert.equal((await handler(goods)).ErrCode,1);assert.equal(state.queries,0);
  config.testers=['alice'];state.remote.status=1;
  assert.equal((await handler(goods)).ErrMsg,'PAYMENT_NOT_PAID');
  assert.equal((await store.order(order.id)).status,'created');assert.equal((await store.profile('alice')).credits,0);
});

test('failed delivery acknowledgement stays retryable without granting twice',async()=>{
  const {store,order,state,handler,goods}=await notificationFixture();
  state.deliveryError=new Error('synthetic delivery failure');
  assert.equal((await handler(goods)).ErrCode,1);assert.equal((await store.order(order.id)).delivered,false);
  assert.equal((await store.profile('alice')).credits,1);
  state.deliveryError=null;assert.equal((await handler(goods)).ErrCode,0);
  assert.equal(state.deliveries,2);assert.equal((await store.order(order.id)).delivered,true);
  assert.equal((await store.profile('alice')).credits,1);
});

test('forged refund hints and unavailable platform queries never revoke a paid month',async()=>{
  const {store,state,handler,goods,refund}=await notificationFixture('month');
  assert.equal((await handler(goods)).ErrCode,0);
  assert.equal((await handler(refund)).ErrMsg,'REFUND_NOT_CONFIRMED');
  state.queryError=new Error('synthetic query failure');
  assert.equal((await handler(refund)).ErrCode,1);assert.equal((await store.profile('alice')).isMember,true);
});

test('authoritative cumulative refunds revoke access idempotently, including iOS orders',async()=>{
  const {store,order,state,handler,goods,refund}=await notificationFixture('month');
  state.remote.order_type=7;await handler(goods);
  state.remote.left_fee=0;
  assert.equal((await handler(refund)).ErrCode,0);assert.equal((await handler(refund)).ErrCode,0);
  assert.equal((await store.order(order.id)).status,'refunded');assert.equal((await store.profile('alice')).isMember,false);
});

test('refund before goods never grants credit; stale refund hints require sufficient cumulative refunded amount',async()=>{
  const {store,order,state,handler,refund}=await notificationFixture();
  state.remote.left_fee=50;
  assert.equal((await handler(refund)).ErrMsg,'REFUND_NOT_CONFIRMED');
  assert.equal((await handler({...refund,RefundFee:50})).ErrCode,0);
  assert.equal((await store.order(order.id)).status,'refund_review');assert.equal((await store.profile('alice')).credits,0);
  state.remote.left_fee=0;assert.equal((await handler(refund)).ErrCode,0);
  assert.equal((await store.order(order.id)).status,'refunded');
});

test('reconciliation and native refunds validate original payment identity and amount before revoking',async()=>{
  const {store,order,state,wechat,handler,goods,refund}=await notificationFixture();
  await handler(goods);const correct=remote(order,{left_fee:0});
  for(const patch of [{order_id:'another'},{env_type:2},{order_type:1},{order_fee:1},{paid_fee:1},{wx_order_id:'another'},{left_fee:-1}]) {
    state.remote={...correct,...patch};
    await assert.rejects(new CloudPayments(store,wechat).sync(order,'test'),{code:'PAYMENT_MISMATCH'});
    assert.equal((await handler(refund)).ErrCode,1);
    assert.equal((await store.profile('alice')).credits,1);
  }
});

test('development mode never acknowledges payment event hints',async()=>{
  const {config,state,handler,goods}=await notificationFixture();config.mode='development';
  assert.equal((await handler(goods)).ErrMsg,'PAYMENT_NOT_CONFIGURED');assert.equal(state.queries,0);
});

test('native paid callback uses the actual signed HTTP adapter and remains idempotent',async()=>{
  const {store,order,config,goods}=await notificationFixture();let deliveryCalls=0;
  const wechat=new WeChat({...config,appKey:'synthetic-key'},async(url,options)=>{
    url=new URL(url);
    if(url.pathname==='/cgi-bin/stable_token')return {ok:true,json:async()=>({access_token:'token',expires_in:7200})};
    if(url.searchParams.get('pay_sig')!==paySignature('synthetic-key',url.pathname,options.body))return {ok:true,json:async()=>({errcode:268490002,errmsg:'签名字段[pay_sig]为空 rid: aaaaaaaa-bbbbbbbb-cccccccc'})};
    if(url.pathname==='/xpay/query_order')return {ok:true,json:async()=>({errcode:0,order:remote(order,{left_fee:order.price})})};
    assert.equal(url.pathname,'/xpay/notify_provide_goods');deliveryCalls++;
    return {ok:true,json:async()=>({errcode:0,errmsg:'ok'})};
  });
  const handler=createHandler({getWXContext:()=>({})},{config,store,files:{},wechat});
  assert.equal((await handler(goods)).ErrCode,0);assert.equal((await handler(goods)).ErrCode,0);
  assert.equal((await store.order(order.id)).delivered,true);
  assert.equal(deliveryCalls,1);assert.equal((await store.profile('alice')).credits,1);
});

test('a reused provider error number cannot hide signature failures as an unregistered order',async()=>{
  const {store,order,state,wechat}=await notificationFixture();
  for(const providerMessage of ['签名字段[pay_sig]为空 rid: aaaaaaaa-bbbbbbbb-cccccccc','invalid pay_sig','']) {
    state.queryError=Object.assign(new Error('synthetic provider failure'),{code:'WECHAT_268490002',providerMessage});
    await assert.rejects(new CloudPayments(store,wechat).sync(order,'signature-error'),{code:'WECHAT_268490002'});
  }
});

test('unregistered created orders remain observable and unpaid; payment hints cannot acknowledge them',async()=>{
  const {store,order,state,wechat,handler,goods}=await notificationFixture();
  state.queryError=Object.assign(new Error('synthetic missing platform order'),{code:'WECHAT_268490002',providerMessage:'数据不存在 rid: aaaaaaaa-bbbbbbbb-cccccccc'});
  const result=await new CloudPayments(store,wechat).sync(order,'test-not-registered');
  assert.equal(result.status,'created');assert.equal(result.platform_state,'not_registered');assert.equal(result.platform_error_code,'WECHAT_268490002');assert.ok(result.last_checked>0);
  assert.equal((await handler(goods)).ErrMsg,'PAYMENT_NOT_PAID');assert.equal((await store.profile('alice')).credits,0);
  state.queryError=null;assert.equal((await handler(goods)).ErrCode,0);
  assert.equal((await store.order(order.id)).platform_state,'found');assert.equal((await store.profile('alice')).credits,1);
});

test('missing paid orders and other provider errors remain hard failures',async()=>{
  const {store,order,state,wechat,handler,goods}=await notificationFixture();
  state.queryError=Object.assign(new Error('synthetic outage'),{code:'WECHAT_NETWORK'});
  await assert.rejects(new CloudPayments(store,wechat).sync(order,'test'),{code:'WECHAT_NETWORK'});
  state.queryError=null;await handler(goods);
  state.queryError=Object.assign(new Error('synthetic missing paid order'),{code:'WECHAT_268490002',providerMessage:'数据不存在 rid: aaaaaaaa-bbbbbbbb-cccccccc'});
  await assert.rejects(new CloudPayments(store,wechat).sync(await store.order(order.id),'test'),{code:'WECHAT_268490002'});
  // Also reject a stale created snapshot after a concurrent fulfillment.
  await assert.rejects(new CloudPayments(store,wechat).sync(order,'test'),{code:'WECHAT_268490002'});
  assert.equal((await store.profile('alice')).credits,1);
});

test('cloud orders reject forged amount and duplicate WeChat receipt atomically',async()=>{
  const db=new Database(),store=new CloudStore(db),one=await store.createOrder('alice','single','one',100);
  await assert.rejects(store.fulfill(one.id,remote(one,{paid_fee:1})),{code:'PAYMENT_MISMATCH'});
  await store.fulfill(one.id,remote(one));await store.fulfill(one.id,remote(one));
  const two=await store.createOrder('bob','single','one',100);
  await assert.rejects(store.fulfill(two.id,remote(two,{wx_order_id:'wx-'+one.id})),{code:'DUPLICATE_PAYMENT'});
  assert.equal((await store.profile('alice')).credits,1);assert.equal((await store.profile('bob')).credits,0);
});
test('two concurrent cloud jobs cannot spend one credit twice; failure releases it',async()=>{
  const store=new CloudStore(new Database());await paid(store);
  const ids=[randomUUID(),randomUUID()];
  const results=await Promise.allSettled(ids.map(id=>store.reserve('alice',id,'lottery','same',false)));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const winner=ids[results.findIndex(x=>x.status==='fulfilled')];
  assert.equal((await store.profile('alice')).credits,0);
  await store.finish(winner,null,'INVALID_NAMES');assert.equal((await store.profile('alice')).credits,1);
  const next=randomUUID();await store.reserve('alice',next,'lottery','new',false);await store.finish(next,{winners:['A']});
  assert.equal((await store.profile('alice')).credits,0);
});
test('cloud refund removes monthly access and cannot regrant from a repeated notification',async()=>{
  const store=new CloudStore(new Database()),order=await paid(store,'alice','month');
  assert.equal((await store.profile('alice')).isMember,true);
  await store.refund(order.id,990,remote(order,{left_fee:0}));assert.equal((await store.profile('alice')).isMember,false);
  await assert.rejects(store.fulfill(order.id,remote(order)),{code:'ORDER_STATE'});
});
test('cloud job IDs bind owner, tool, content and result expiry',async()=>{
  let now=Date.now();const store=new CloudStore(new Database(),()=>now),id=randomUUID();
  await store.reserve('alice',id,'lottery','a',true);await store.finish(id,{jobId:id,winners:['A']});
  assert.equal((await store.reserve('alice',id,'lottery','a',true)).existing,true);
  await assert.rejects(store.reserve('bob',id,'lottery','a',true),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(store.reserve('alice',id,'lottery','b',true),{code:'IDEMPOTENCY_CONFLICT'});
  now+=3600001;await assert.rejects(store.reserve('alice',id,'lottery','a',true),{code:'RESULT_EXPIRED'});
});
test('cloud handler trusts injected identity, enforces tester allowlist and prevents fake timers',async()=>{
  const store=new CloudStore(new Database()),config=cloudConfig({LIGHT_MODE:'development',LIGHT_TEST_OPENIDS:'alice',LIGHT_MAINTENANCE_TOKEN:'a'.repeat(64)});
  let identity={APPID:APP_ID,OPENID:'mallory'},cleaned=0;
  const handler=createHandler({getWXContext:()=>identity},{config,store,files:{cleanup:async()=>{cleaned++;return {};}}});
  assert.equal((await handler({path:'/api/me',data:{openid:'alice'}})).error.code,'DEVELOPMENT_ONLY');
  identity={APPID:APP_ID,OPENID:'alice'};
  await assert.rejects(handler({Type:'Timer',path:'/none'}),{code:'MAINTENANCE_AUTH'});assert.equal(cleaned,0);
  const id=randomUUID(),data={title:'周末转盘',entries:[{id:'a',label:'咖啡',weight:1},{id:'b',label:'电影',weight:3}]},event={path:'/api/tools/lottery',method:'POST',jobId:id,data};
  const result=await handler(event);
  assert.equal(result.ok,true);assert.equal(result.data.winners.length,1);assert.equal(result.data.winner.id,data.entries[result.data.winnerIndex].id);
  assert.deepEqual((await handler(event)).data,result.data);
  assert.equal((await handler({...event,data:{...data,entries:[{...data.entries[0],weight:5},data.entries[1]]}})).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await handler({path:'/api/orders',method:'POST',data:{sku:'single'}})).error.code,'PAYMENT_NOT_CONFIGURED');
});
test('cloud upload reserves exact file IDs before upload and download checks owner/expiry',async()=>{
  let now=Date.now();const store=new CloudStore(new Database(),()=>now),removed=[];
  const cloud={getUploadMetadata:async({cloudPath})=>({data:{fileId:'cloud://'+ENV_ID+'.bucket/'+cloudPath}}),deleteFile:async({fileList})=>{removed.push(...fileList);return {fileList:fileList.map(()=>({status:0}))};},getTempFileURL:async()=>({fileList:[{status:0,tempFileURL:'https://private.example/result'}]})};
  const files=new CloudFiles(cloud,store,ENV_ID),ticket=await files.ticket('alice',2),saved=await store.get('uploads',ticket.ticketId);
  assert.equal(saved.file_ids.length,2);await files.cleanupTicket(ticket.ticketId);assert.equal(removed.length,2);
  const another=await files.ticket('alice',1),saved2=await store.get('uploads',another.ticketId);
  await assert.rejects(files.bind('bob',another.ticketId,saved2.file_ids),{code:'UPLOAD_EXPIRED'});
  await assert.rejects(files.bind('alice',another.ticketId,['cloud://'+ENV_ID+'.evil/'+another.paths[0]]),{code:'FILE_OWNER'});
  const id=randomUUID();await store.reserve('alice',id,'compress','hash',true);await store.finish(id,{artifact:{expiresAt:now+3600000,fileID:saved2.file_ids[0]}});
  await assert.rejects(files.download('bob',id),{code:'FILE_NOT_FOUND'});assert.equal((await files.download('alice',id)).fileID,saved2.file_ids[0]);
  now+=3600001;await assert.rejects(files.download('alice',id),{code:'FILE_EXPIRED'});
});
test('closed cloud configuration is safe by default and real payments require completed setup',()=>{
  assert.equal(cloudConfig({}).mode,'closed');
  assert.throws(()=>cloudConfig({LIGHT_MODE:'development'}),{code:'CONFIG'});
  assert.throws(()=>cloudConfig({LIGHT_MODE:'production'}),{code:'CONFIG'});
});

test('cleanup accepts already absent uploads but preserves tickets on provider failures or incomplete responses',async()=>{
  const store=new CloudStore(new Database());let statuses=[-503003];
  const files=new CloudFiles({deleteFile:async()=>({fileList:statuses.map(status=>({status}))})},store,ENV_ID);
  await store.put('uploads','abandoned',{file_ids:['never-uploaded']});
  await files.cleanupTicket('abandoned');assert.equal(await store.get('uploads','abandoned'),null);
  await store.put('uploads','denied',{file_ids:['one','two']});
  statuses=[0,-503002];await assert.rejects(files.cleanupTicket('denied'),{code:'FILE_CLEANUP'});
  assert.ok(await store.get('uploads','denied'));
  statuses=[];await assert.rejects(files.cleanupTicket('denied'),{code:'FILE_CLEANUP'});
  statuses=[-503003,0];await files.cleanupTicket('denied');assert.equal(await store.get('uploads','denied'),null);
});

test('production authorization is separate from payment acceptance and still requires complete payment config',()=>{
  const env={LIGHT_MODE:'verification',LIGHT_TEST_OPENIDS:'alice',WECHAT_APP_SECRET:'test',XPAY_OFFER_ID:'test',XPAY_APP_KEY:'test',XPAY_PRODUCT_SINGLE:'one',XPAY_PRODUCT_MONTH:'month',WECHAT_PUSH_TOKEN:'test',WECHAT_PUSH_AES_KEY:'a'.repeat(43),WECHAT_ORIGINAL_ID:'gh_test'};
  assert.equal(cloudConfig(env).mode,'verification');
  assert.throws(()=>cloudConfig({...env,LIGHT_MODE:'production'}),{code:'PRODUCTION_SETUP'});
  assert.throws(()=>cloudConfig({...env,LIGHT_MODE:'production',LIGHT_PAYMENT_VERIFIED:'true'}),{code:'PRODUCTION_SETUP'});
  assert.equal(cloudConfig({...env,LIGHT_MODE:'production',LIGHT_PRODUCTION_ENABLED:'true',LIGHT_PAYMENT_VERIFIED:'false',LIGHT_TEST_OPENIDS:''}).mode,'production');
  assert.throws(()=>cloudConfig({...env,LIGHT_MODE:'production',LIGHT_PRODUCTION_ENABLED:'true',WECHAT_APP_SECRET:''}),{code:'CONFIG'});
  assert.throws(()=>cloudConfig({...env,LIGHT_TEST_OPENIDS:''}),{code:'CONFIG'});
});

test('production admits a non-tester but keeps identity, payment and file access boundaries',async()=>{
  const config=cloudConfig({LIGHT_MODE:'verification',LIGHT_TEST_OPENIDS:'alice',WECHAT_APP_SECRET:'test',XPAY_OFFER_ID:'test',XPAY_APP_KEY:'test',XPAY_PRODUCT_SINGLE:'one',XPAY_PRODUCT_MONTH:'month',WECHAT_PUSH_TOKEN:'test',WECHAT_PUSH_AES_KEY:'a'.repeat(43),WECHAT_ORIGINAL_ID:'gh_test'});
  const db=new Database(),store=new CloudStore(db),files=new CloudFiles({},store,ENV_ID);
  const cloud={getWXContext:()=>({APPID:APP_ID,OPENID:'new-public-user'})};
  const handler=createHandler(cloud,{config,store,files});
  assert.equal((await handler({path:'/api/config'})).error.code,'DEVELOPMENT_ONLY');
  config.mode='production';
  assert.equal((await handler({path:'/api/config'})).ok,true);
  const profile=await handler({path:'/api/me'});
  assert.equal(profile.ok,true);assert.equal(profile.data.isMember,false);assert.equal(profile.data.credits,0);
  await assert.rejects(store.reserve('new-public-user',randomUUID(),'compress','file-hash',false),{code:'PAYMENT_REQUIRED'});
  assert.equal((await handler({path:'/api/identity'})).error.code,'IDENTITY_UNAVAILABLE');
  assert.equal((await handler({path:'/api/download',method:'POST',data:{jobId:randomUUID()}})).error.code,'FILE_NOT_FOUND');
  cloud.getWXContext=()=>({APPID:'wrong-app',OPENID:'new-public-user'});
  assert.equal((await handler({path:'/api/config'})).error.code,'UNAUTHORIZED');
});

test('maintenance errors fail the invocation rather than becoming a successful error envelope',async()=>{
  const error=new Error('storage unavailable');
  const handler=createHandler({getWXContext:()=>({OPENID:'stale-context'})},{config:cloudConfig({LIGHT_MAINTENANCE_TOKEN:'a'.repeat(64)}),store:{},files:{cleanup:async()=>{throw error;}}});
  await assert.rejects(handler({Type:'Timer',Message:'a'.repeat(64)}),error);
});
test('cloud compression processes real bytes, commits a recoverable result and removes the original',async()=>{
  const store=new CloudStore(new Database()),objects=new Map();
  const fileId=path=>'cloud://'+ENV_ID+'.bucket/'+path;
  const cloud={
    getWXContext:()=>({APPID:APP_ID,OPENID:'alice'}),
    getUploadMetadata:async({cloudPath})=>({data:{fileId:fileId(cloudPath)}}),
    getTempFileURL:async({fileList})=>({fileList:fileList.map(f=>({status:0,tempFileURL:'https://fixture.test/'+encodeURIComponent(f.fileID)}))}),
    uploadFile:async({cloudPath,fileContent})=>{objects.set(fileId(cloudPath),fileContent);return {fileID:fileId(cloudPath)};},
    deleteFile:async({fileList})=>{fileList.forEach(f=>objects.delete(f));return {fileList:fileList.map(()=>({status:0}))};}
  };
  const files=new CloudFiles(cloud,store,ENV_ID,async url=>new Response(objects.get(decodeURIComponent(new URL(url).pathname.slice(1)))));
  const handler=createHandler(cloud,{config:cloudConfig({LIGHT_MODE:'development',LIGHT_TEST_OPENIDS:'alice'}),store,files});
  const ticket=await files.ticket('alice',1),saved=await store.get('uploads',ticket.ticketId);
  objects.set(saved.file_ids[0],await sharp({create:{width:100,height:100,channels:3,background:'#b4b9a4'}}).png().toBuffer());
  const id=randomUUID(),result=await handler({path:'/api/tools/compress',method:'POST',jobId:id,data:{ticketId:ticket.ticketId,fileIds:saved.file_ids,fields:{quality:70}}});
  assert.equal(result.ok,true);assert.equal(result.data.artifact.jobId,id);
  assert.equal(objects.has(saved.file_ids[0]),false);assert.equal((await store.get('jobs',id)).status,'succeeded');
  assert.equal((await sharp(objects.get(result.data.artifact.fileID)).metadata()).width,100);
});

test('cloud config, quote, signed order and later fulfillment use one configured amount', async () => {
  const store = new CloudStore(new Database());
  const config = cloudConfig({LIGHT_MODE:'verification',LIGHT_TEST_OPENIDS:'alice',WECHAT_APP_SECRET:'test',XPAY_OFFER_ID:'test',XPAY_APP_KEY:'test',XPAY_PRODUCT_SINGLE:'one',XPAY_PRODUCT_MONTH:'month',WECHAT_PUSH_TOKEN:'test',WECHAT_PUSH_AES_KEY:'a'.repeat(43),WECHAT_ORIGINAL_ID:'gh_test',LIGHT_PRICE_MONTH_FEN:'110'});
  let logins=0;
  const handler=createHandler({getWXContext:()=>({APPID:APP_ID,OPENID:'alice'})},{config,store,files:{},wechat:{login:async()=>{logins++;return {openid:'alice',session_key:'synthetic-session'};}}});
  const displayed=await handler({path:'/api/config'});assert.equal(displayed.data.prices.month.price,110);
  const event={path:'/api/orders',method:'POST',data:{sku:'month',platform:'android',code:'synthetic-code'}};
  assert.equal((await handler(event)).error.code,'PRICE_QUOTE_REQUIRED');
  assert.equal((await handler({...event,data:{...event.data,expectedPrice:990}})).error.code,'PRICE_CHANGED');
  assert.equal((await handler({...event,data:{...event.data,expectedPrice:110,sku:'constructor'}})).error.code,'INVALID_PRODUCT');
  assert.equal(logins,0);assert.equal((await store.orders('alice')).length,0);
  const result=await handler({...event,data:{...event.data,expectedPrice:110}});
  assert.equal(result.ok,true);assert.equal(logins,1);
  assert.equal(JSON.parse(result.data.payData.signData).goodsPrice,110);
  const order=await store.order(result.data.orderId);assert.equal(order.price,110);
  config.prices=cloudConfig({LIGHT_MODE:'development',LIGHT_TEST_OPENIDS:'alice',LIGHT_PRICE_MONTH_FEN:'990'}).prices;
  const confirmed=await store.fulfill(order.id,remote(order));
  assert.equal((await store.profile('alice')).memberUntil,confirmed.paid_at+30*86400000);
  await store.refund(order.id,110,remote(order,{left_fee:0}));
  assert.equal((await store.profile('alice')).isMember,false);assert.equal((await store.order(order.id)).price,110);
});
