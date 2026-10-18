import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { AppError, requireValue, log } from './shared/errors.js';
import { quotedPrice } from './shared/config.js';
import { WeChat, createPayData, verifyPushUrl, decryptPush, parseXml } from './shared/wechat.js';
import { TOOL_NAMES, compressImage, mergePdfs, makeIdPhoto, drawLottery, portraitProvider } from './shared/tools.js';
import { CloudStore } from './store.js';
import { CloudFiles } from './files.js';
import { CloudPayments } from './payment.js';
import { cloudConfig } from './config.js';
import { handlePaymentNotification } from './notifications.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function createHandler(cloud,options={}) {
  const config=options.config || cloudConfig(),store=options.store || new CloudStore(cloud.database());
  const files=options.files || new CloudFiles(cloud,store,config.envId);
  const wechat=options.wechat || new WeChat(config),payments=new CloudPayments(store,wechat),segment=options.segment || portraitProvider(config);
  return async function main(event={}) {
    const requestId=randomUUID(),started=Date.now(),context=cloud.getWXContext(),userId=context.OPENID;
    log('cloud.request.started',{requestId,isTimer:event.Type==='Timer',invocationSource:context.SOURCE || 'unknown',hasIdentity:Boolean(userId),payloadType:typeof event});
    try {
      // Warm SCF invocations can retain WX context from a previous client call.
      // Authenticate maintenance independently of that context. The secret is
      // configured only in the timer's CustomArgument and server environment.
      if(event.Type==='Timer') {
        requireValue(typeof config.maintenanceToken==='string' && config.maintenanceToken.length>=64,'MAINTENANCE_CONFIG','维护任务尚未配置',503);
        requireValue(typeof event.Message==='string' && timingSafeEqual(createHash('sha256').update(event.Message).digest(),createHash('sha256').update(config.maintenanceToken).digest()),'MAINTENANCE_AUTH','维护任务签名无效',403);
        const cleanup=await files.cleanup();
        const payment=['production','verification'].includes(config.mode)?await payments.reconcile():{disabled:true};
        return {ok:true,data:{cleanup,payment},requestId};
      }
      // A signed URL handshake can be verified before products are published.
      // Payment notifications still require verification/production and AES validation.
      if(event.httpMethod) {
        const query=event.queryStringParameters || {};
        if(event.httpMethod==='GET') {
          requireValue(['development','verification','production'].includes(config.mode),'PAYMENT_NOT_CONFIGURED','支付尚未开通',503);
          const echo=verifyPushUrl(config,query);
          log('payment.callback.verified',{requestId});
          return {statusCode:200,headers:{'content-type':'text/plain'},body:echo};
        }
        requireValue(['production','verification'].includes(config.mode),'PAYMENT_NOT_CONFIGURED','支付尚未开通',503);
        requireValue(event.httpMethod==='POST' && typeof event.body==='string','INVALID_MESSAGE','消息格式无效');
        const raw=event.isBase64Encoded?Buffer.from(event.body,'base64').toString():event.body;
        requireValue(raw.length<=131072,'INVALID_MESSAGE','消息过大');
        const message=parseXml(decryptPush(config,query,parseXml(raw).Encrypt));
        await handlePaymentNotification({message,config,store,payments,requestId,signedHttp:true});
        return {statusCode:200,headers:{'content-type':'application/xml'},body:'<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>'};
      }
      if(event.MsgType==='event')return await handlePaymentNotification({message:event,config,store,payments,requestId});
      requireValue(context.APPID===config.appId && typeof userId==='string' && userId.length>0,'UNAUTHORIZED','无法确认微信身份',401);
      // Test enrollment reveals only the authenticated caller's own identity.
      // It never trusts a supplied OpenID, writes a profile, or grants access.
      if(event.path==='/api/identity' && (!event.method || event.method==='GET')) {
        requireValue(['closed','development','verification'].includes(config.mode),'IDENTITY_UNAVAILABLE','正式版不提供测试账号识别',404);
        log('cloud.identity.completed',{requestId,mode:config.mode,elapsedMs:Date.now()-started});
        return {ok:true,data:{openid:userId,mode:config.mode},requestId};
      }
      requireValue(config.mode!=='closed','CLOUD_SETUP','云端尚未完成安全配置，请稍后再来',503);
      const development=config.mode==='development';
      requireValue(!['development','verification'].includes(config.mode) || config.testers.includes(userId),'DEVELOPMENT_ONLY','当前仅向配置的测试账号开放',403);
      const path=event.path,method=event.method || 'GET',data=event.data || {};
      let result;
      if(path==='/api/config' && method==='GET') result={mode:config.mode,prices:config.prices,tools:Object.keys(TOOL_NAMES).map(id=>({id,name:TOOL_NAMES[id],available:id!=='photo' || Boolean(segment)})),iosEnabled:config.iosEnabled,artifactTtl:config.artifactTtl};
      else if(path==='/api/me' && method==='GET') result={...await store.profile(userId),local:development};
      else if(path==='/api/orders' && method==='GET')result=await store.orders(userId);
      else if(path==='/api/jobs' && method==='GET')result=await store.jobs(userId);
      else if(path==='/api/orders' && method==='POST') {
        requireValue(!development,'PAYMENT_NOT_CONFIGURED','云端测试不发起真实支付',503);
        requireValue(['ios','android','windows','mac','ohos','devtools'].includes(data.platform),'PLATFORM','平台参数无效');
        requireValue(data.platform!=='ios' || config.iosEnabled,'IOS_NOT_ENABLED','iOS 支付尚未开通',503);
        const price=quotedPrice(config.prices,data.sku,data.expectedPrice);
        requireValue(typeof data.code==='string' && data.code.length<=256,'LOGIN_CODE','支付登录 code 缺失');
        const login=await wechat.login(data.code);
        requireValue(login.openid===userId,'IDENTITY_MISMATCH','支付登录身份不一致',401);
        const order=await store.createOrder(userId,data.sku,config.products[data.sku],price);
        log('payment.created',{requestId,orderId:order.id,sku:order.sku,price:order.price});
        result={orderId:order.id,payData:createPayData(config,order,login.session_key)};
      } else if(/^\/api\/orders\/L[a-f0-9]{30}\/sync$/.test(path) && method==='POST') {
        requireValue(!development,'PAYMENT_NOT_CONFIGURED','云端测试不查询真实支付',503);
        const order=await store.order(path.split('/')[3]);
        requireValue(order && order.user_id===userId,'ORDER_NOT_FOUND','订单不存在',404);
        const current=await payments.sync(order,requestId);result={id:current.id,status:current.status};
      } else if(path==='/api/uploads' && method==='POST')result=await files.ticket(userId,data.count);
      else if(path==='/api/uploads/bind' && method==='POST') {await files.bind(userId,data.ticketId,data.fileIds);result={ok:true};}
      else if(path==='/api/download' && method==='POST')result=await files.download(userId,data.jobId);
      else if(typeof path==='string' && path.startsWith('/api/tools/') && method==='POST') {
        const tool=path.slice('/api/tools/'.length),id=event.jobId;
        requireValue(Object.hasOwn(TOOL_NAMES,tool) && UUID.test(id),'INVALID_JOB','工具或任务编号无效');
        requireValue(tool!=='photo' || segment,'PHOTO_NOT_CONFIGURED','证件照服务尚未开通',503);
        const buffers=[];
        if(tool!=='lottery') {
          await files.bind(userId,data.ticketId,data.fileIds);
          requireValue(tool==='pdf'?data.fileIds.length>=2:data.fileIds.length===1,'FILE_COUNT','文件数量不符合要求');
          for(const fileId of data.fileIds)buffers.push(await files.read(fileId));
          requireValue(buffers.reduce((n,b)=>n+b.length,0)<=40*1024*1024,'TOTAL_SIZE','文件总大小不能超过 40MB');
        }
        const fields=data.fields || data;
        const digest=createHash('sha256').update(JSON.stringify({tool,entries:fields.entries,title:fields.title,quality:fields.quality,size:fields.size,background:fields.background}));
        buffers.forEach(b=>digest.update(String(b.length)+':').update(b));
        const reservation=await store.reserve(userId,id,tool,digest.digest('hex'),development);
        if(reservation.existing)result=reservation.result;
        else {
          let artifact;
          try {
            log('cloud.tool.started',{requestId,jobId:id,tool});
            let output;
            if(tool==='lottery')output={details:drawLottery(fields.entries,fields.title)};
            else if(tool==='pdf')output=await mergePdfs(buffers);
            else if(tool==='compress')output=await compressImage(buffers[0],Number(fields.quality));
            else output=await makeIdPhoto(buffers[0],fields.size,fields.background,segment,requestId);
            if(output.buffer)artifact=await files.output(userId,id,tool,output);
            result={jobId:id,tool,...output.details,artifact:artifact || null};
            if(data.ticketId)await files.cleanupTicket(data.ticketId);
            await store.finish(id,result);
          } catch(error) {
            // If committing completion failed, its outcome may be unknown. Leave
            // the reservation for reconciliation instead of refunding blindly.
            const current=await store.get('jobs',id);
            if(current.status==='processing')await store.finish(id,null,error.code || 'PROCESSING_FAILED');
            if(artifact && current.status!=='succeeded')await files.remove([artifact.fileID]);
            throw error;
          }
        }
        if(reservation.existing && data.ticketId)await files.cleanupTicket(data.ticketId);
      } else throw new AppError('NOT_FOUND','接口不存在',404);
      log('cloud.request.completed',{requestId,path,elapsedMs:Date.now()-started});
      return {ok:true,data:result,requestId};
    } catch(error) {
      const expected=error instanceof AppError;
      log('cloud.request.failed',{requestId,code:error.code || 'INTERNAL',errorName:error.name,paymentOperation:error.operation,providerRequestId:error.providerRequestId || error.requestId,frames:expected?undefined:String(error.stack || '').split('\n').slice(1,6)},'error');
      const body={ok:false,error:{code:expected?error.code:'INTERNAL',message:expected?error.message:'云端处理失败，请凭错误编号联系支持',requestId}};
      if(event.Type==='Timer')throw error;
      if(event.httpMethod)return {statusCode:expected?error.status:500,headers:{'content-type':'application/json'},body:JSON.stringify(body)};
      if(event.MsgType==='event')return {ErrCode:1,ErrMsg:body.error.code,requestId};
      return body;
    }
  };
}
