import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readdirSync, statSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from './store.js';
import { quotedPrice } from './config.js';
import { WeChat, createPayData, verifyPushUrl, decryptPush, parseXml } from './wechat.js';
import { PaymentService } from './payment-service.js';
import { TOOL_NAMES, compressImage, mergePdfs, makeIdPhoto, drawLottery, portraitProvider } from './tools.js';
import { AppError, requireValue, log } from './errors.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function createApp(config, dependencies={}) {
  mkdirSync(config.dataDir,{recursive:true});
  const filesDir=path.join(config.dataDir,'results'); mkdirSync(filesDir,{recursive:true});
  const store=dependencies.store || new Store(path.join(config.dataDir,'toolbox.sqlite'),config.encryptionKey);
  const wechat=dependencies.wechat || new WeChat(config);
  const segment=dependencies.segment || portraitProvider(config);
  const payments=new PaymentService(store,wechat);
  const app=express(); app.disable('x-powered-by'); app.set('trust proxy','loopback');
  app.use(helmet({contentSecurityPolicy:{directives:{imgSrc:["'self'",'blob:','data:'],scriptSrc:["'self'"],styleSrc:["'self'"],connectSrc:["'self'"]}}}));
  app.use((req,res,next)=>{
    req.requestId=randomUUID(); res.setHeader('X-Request-ID',req.requestId);
    const started=Date.now();
    res.on('finish',()=>log('http.complete',{requestId:req.requestId,method:req.method,path:req.path,status:res.statusCode,elapsedMs:Date.now()-started}));
    next();
  });
  app.use('/api',rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false,handler:(req,res)=>res.status(429).json({error:{code:'RATE_LIMIT',message:'操作较频繁，请一分钟后再试',requestId:req.requestId}})}));
  app.get('/health',(_req,res)=>res.json({ok:true}));

  // URL verification uses a signed GET; payment events require encrypted POST.
  app.get('/api/pay/notify',(req,res)=>{
    requireValue(config.mode==='production','PAYMENT_NOT_CONFIGURED','本地模式不接收支付通知',503);
    res.type('text').send(verifyPushUrl(config,req.query));
  });
  app.post('/api/pay/notify',express.text({type:['text/*','application/xml'],limit:'128kb'}),async(req,res)=>{
    requireValue(config.mode==='production','PAYMENT_NOT_CONFIGURED','本地模式不接收支付通知',503);
    requireValue(typeof req.body==='string','INVALID_MESSAGE','消息推送须配置安全模式 XML');
    const envelope=parseXml(req.body);
    const event=parseXml(decryptPush(config,req.query,envelope.Encrypt));
    requireValue(event.ToUserName===config.originalId,'RECIPIENT_MISMATCH','消息接收者不匹配',401);
    if(event.Event==='xpay_goods_deliver_notify') {
      const order=store.order(event.OutTradeNo), goods=event.GoodsInfo;
      requireValue(order && order.user_id===event.OpenId && Number(event.Env)===0,'ORDER_MISMATCH','支付通知订单不匹配',409);
      requireValue(goods && goods.ProductId===order.product_id && Number(goods.Quantity)===1 && Number(goods.ActualPrice)===order.price && Number(goods.OrigPrice)===order.price,'PRODUCT_MISMATCH','支付通知商品或金额不匹配',409);
      const paid=await payments.sync(order,req.requestId,true);
      requireValue(paid.status==='paid','PAYMENT_NOT_PAID','微信尚未确认付款',409);
    } else if(event.Event==='xpay_refund_notify') {
      requireValue(Number(event.RetCode)===0,'REFUND_NOT_COMPLETE','退款尚未完成',409);
      const order=store.order(event.MchOrderId) || store.db.prepare('SELECT * FROM orders WHERE wx_id=? OR channel_id=?').get(event.WxOrderId || '',event.MchOrderId || '');
      requireValue(order && order.user_id===event.OpenId,'ORDER_MISMATCH','退款通知订单不匹配',409);
      store.refund(order.id,Number(event.RefundFee),req.requestId);
    } else {
      store.audit('payment.unhandled_event',null,req.requestId,{event:event.Event});
      throw new AppError('UNHANDLED_PAYMENT_EVENT','此消息类型需要人工处理，请检查服务端事件记录',422);
    }
    res.type('application/xml').send('<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>');
  });
  app.use(express.json({limit:'128kb'}));
  app.get('/api/config',(_req,res)=>res.set('Cache-Control','no-store').json({mode:config.mode,prices:config.prices,tools:Object.keys(TOOL_NAMES).map(id=>({id,name:TOOL_NAMES[id],available:id!=='photo' || Boolean(segment)})),iosEnabled:config.iosEnabled,artifactTtl:config.artifactTtl}));
  app.post('/api/auth/login',rateLimit({windowMs:60000,limit:15}),async(req,res)=>{
    requireValue(config.mode==='production','LOCAL_MODE','本地预览请使用本地体验登录',503);
    requireValue(typeof req.body.code==='string' && req.body.code.length>0 && req.body.code.length<=256,'LOGIN_CODE','微信登录 code 缺失');
    const result=await wechat.login(req.body.code);
    res.json({token:store.login(result.openid,result.session_key)});
  });
  if(config.mode==='local') {
    app.get('/pricing-core.js',(_req,res)=>res.sendFile(path.join(root,'miniprogram/utils/pricing.js')));
    app.get('/wheel-core.js',(_req,res)=>res.sendFile(path.join(root,'miniprogram/utils/wheel.js')));
    app.post('/api/auth/local',(req,res)=>{
      const allowed=new Set([`http://127.0.0.1:${config.port}`,`http://localhost:${config.port}`]);
      requireValue(!req.headers.origin || allowed.has(req.headers.origin),'ORIGIN','本地体验仅允许同源访问',403);
      requireValue(uuidPattern.test(req.body.deviceId),'DEVICE_ID','本地设备编号无效');
      res.json({token:store.login('local:'+req.body.deviceId,'local-only')});
    });
  }
  app.use('/api',(req,res,next)=>{
    const token=(req.get('Authorization') || '').replace(/^Bearer /,'');
    req.session=store.session(token);
    if(!req.session) return next(new AppError('UNAUTHORIZED','登录状态已失效，请重新登录',401));
    res.setHeader('Cache-Control','no-store'); next();
  });
  app.get('/api/me',(req,res)=>res.json({...store.profile(req.session.user_id),local:config.mode==='local'}));
  app.get('/api/orders',(req,res)=>res.json(store.orders(req.session.user_id)));
  app.post('/api/orders',rateLimit({windowMs:60000,limit:6}), (req,res)=>{
    requireValue(config.mode==='production','PAYMENT_NOT_CONFIGURED','本地体验不发起支付，请在微信真机中购买',503);
    requireValue(store.now()-req.session.created_at<5*60000,'SESSION_REFRESH','请重新微信登录后购买',401);
    requireValue(['ios','android','windows','mac','ohos','devtools'].includes(req.body.platform),'PLATFORM','缺少有效的客户端平台');
    requireValue(req.body.platform!=='ios' || config.iosEnabled,'IOS_NOT_ENABLED','iOS 支付尚未开通',503);
    const price=quotedPrice(config.prices,req.body.sku,req.body.expectedPrice);
    const order=store.createOrder(req.session.user_id,req.body.sku,config.products[req.body.sku],price);
    store.audit('payment.created',order.id,req.requestId,{sku:order.sku,price:order.price});
    res.status(201).json({orderId:order.id,payData:createPayData(config,order,store.unseal(req.session.secret))});
  });
  app.post('/api/orders/:id/sync',async(req,res)=>{
    const order=store.order(req.params.id);
    requireValue(order && order.user_id===req.session.user_id,'ORDER_NOT_FOUND','订单不存在',404);
    if(order.status==='created' || (order.status==='paid' && !order.delivered)) await payments.sync(order,req.requestId);
    const current=store.order(order.id); res.json({id:current.id,status:current.status});
  });
  app.get('/api/jobs',(req,res)=>res.json(store.jobs(req.session.user_id)));
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:10,fields:8,fieldSize:64000,parts:18}});
  let activeRequests=0;
  app.post('/api/tools/:tool', (req,_res,next)=>{
    try {
      requireValue(Object.hasOwn(TOOL_NAMES,req.params.tool),'TOOL_NOT_FOUND','工具不存在',404);
      requireValue(activeRequests<4,'BUSY','当前处理任务较多，请稍后再试',503);
      activeRequests++;let released=false;
      req.releaseSlot=()=>{if(!released){released=true;activeRequests--;}};
      _res.once('close',()=>{if(!req.processingStarted)req.releaseSlot();});
      _res.once('finish',req.releaseSlot);next();
    }catch(e){next(e);}
  }, upload.array('files',10), async(req,res)=>{
    const tool=req.params.tool, userId=req.session.user_id, id=req.get('Idempotency-Key');
    requireValue(uuidPattern.test(id),'IDEMPOTENCY_KEY','缺少有效的任务编号');
    const buffers=(req.files || []).map(f=>f.buffer);
    requireValue(buffers.reduce((n,b)=>n+b.length,0)<=40*1024*1024,'TOTAL_SIZE','文件总大小不能超过 40MB');
    requireValue(tool==='lottery' ? buffers.length===0 : tool==='pdf' ? buffers.length>=2 : buffers.length===1,'FILE_COUNT','文件数量不符合要求');
    requireValue(tool!=='photo' || segment,'PHOTO_NOT_CONFIGURED','证件照服务尚未开通，请稍后再来',503);
    const inputHash=createHash('sha256').update(JSON.stringify(req.body)); buffers.forEach(b=>inputHash.update(String(b.length)+':').update(b));
    const reserved=store.reserveJob(userId,id,tool,inputHash.digest('hex'),config.mode==='local');
    if(reserved.existing) return res.json(reserved.result);
    req.processingStarted=true; let outputPath;
    try {
      log('tool.started',{requestId:req.requestId,jobId:id,tool,fileCount:buffers.length});
      let output;
      if(tool==='lottery') {
        output={details:drawLottery(req.body.entries,req.body.title)};
      } else if(tool==='pdf') output=await mergePdfs(buffers);
      else if(tool==='compress') output=await compressImage(buffers[0],Number(req.body.quality));
      else output=await makeIdPhoto(buffers[0],req.body.size,req.body.background,segment,req.requestId);
      let artifact;
      if(output.buffer) {
        artifact={id:randomUUID(),filename:`LIGHT-${tool}-${id.slice(0,8)}.${output.extension}`,mime:output.mime,expiresAt:store.now()+config.artifactTtl};
        outputPath=path.join(filesDir,artifact.id); writeFileSync(outputPath,output.buffer,{flag:'wx',mode:0o600});
      }
      const result={jobId:id,tool,...output.details,artifact:artifact ? {...artifact,url:'/api/files/'+artifact.id}:null};
      store.succeedJob(id,result,artifact); log('tool.completed',{requestId:req.requestId,jobId:id,tool}); res.json(result);
    } catch(error) {
      store.failJob(id,error.code || 'PROCESSING_FAILED');
      if(outputPath && existsSync(outputPath)) unlinkSync(outputPath);
      log('tool.failed',{requestId:req.requestId,jobId:id,tool,code:error.code || 'INTERNAL'},'error'); throw error;
    } finally {req.releaseSlot();}
  });
  app.get('/api/files/:id',(req,res,next)=>{
    requireValue(uuidPattern.test(req.params.id),'FILE_NOT_FOUND','结果文件不存在',404);
    const file=store.db.prepare('SELECT * FROM artifacts WHERE id=? AND user_id=?').get(req.params.id,req.session.user_id);
    requireValue(file,'FILE_NOT_FOUND','结果文件不存在',404);
    requireValue(file.expires_at>store.now(),'FILE_EXPIRED','结果文件已过期，请重新处理',410);
    res.type(file.mime); res.setHeader('Content-Disposition',`attachment; filename="${file.filename}"`);
    res.sendFile(path.join(filesDir,file.id),error=>{if(error)next(error);});
  });
  if(config.mode==='local') {
    app.use('/assets',express.static(path.join(root,'miniprogram/assets')));
    app.use(express.static(path.join(root,'preview')));
  }
  app.use((_req,_res,next)=>next(new AppError('NOT_FOUND','接口不存在',404)));
  app.use((error,req,res,_next)=>{
    if(res.headersSent) {res.destroy(error);return;}
    const expected=error instanceof AppError, multipart=error instanceof multer.MulterError;
    const code=multipart ? error.code : expected ? error.code : 'INTERNAL';
    const status=multipart ? 400 : expected ? error.status : error.type==='entity.parse.failed' ? 400:500;
    log('request.failed',{requestId:req.requestId,code,errorName:error.name,...(!expected && !multipart ? {stack:error.stack}: {})},'error');
    res.status(status).json({error:{code,message:multipart ? '上传超出限制：最多10个文件，单文件10MB' : expected ? error.message:'处理失败，请凭错误编号联系支持',requestId:req.requestId}});
  });
  function cleanup() {
    const expired=store.db.prepare('SELECT id FROM artifacts WHERE expires_at<=?').all(store.now());
    for(const file of expired) {
      const location=path.join(filesDir,file.id); if(existsSync(location))unlinkSync(location);
      store.db.prepare('DELETE FROM artifacts WHERE id=?').run(file.id);
    }
    // Lottery names are only in results and are erased along with other result payloads after one hour.
    store.db.prepare('UPDATE jobs SET result=NULL WHERE finished_at<? AND result IS NOT NULL').run(store.now()-config.artifactTtl);
    // A crash between writing the output file and committing its DB row can leave an orphan.
    for(const name of readdirSync(filesDir)) {
      requireValue(uuidPattern.test(name),'STORAGE_INTEGRITY','结果目录存在未知文件，需人工检查',500);
      const location=path.join(filesDir,name);
      if(statSync(location).mtimeMs<store.now()-config.artifactTtl && !store.db.prepare('SELECT id FROM artifacts WHERE id=?').get(name)) {
        unlinkSync(location);log('files.orphan_removed',{artifactId:name});
      }
    }
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    if(expired.length)log('files.expired',{count:expired.length});
  }
  return {app,store,payments,cleanup};
}
