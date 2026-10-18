import { createHmac, createHash, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { AppError, requireValue, log } from './errors.js';

export const hmac = (key, message) => createHmac('sha256',key).update(message).digest('hex');
export const paySignature = (key, uri, body) => hmac(key,uri+'&'+body);
export function createPayData(config, order, sessionKey) {
  const signData = JSON.stringify({ offerId:config.offerId,buyQuantity:1,env:0,currencyType:'CNY',productId:order.product_id,goodsPrice:order.price,outTradeNo:order.id,attach:order.id });
  return { mode:'short_series_goods',signData,paySig:paySignature(config.appKey,'requestVirtualPayment',signData),signature:hmac(sessionKey,signData) };
}
const parser = new XMLParser({ parseTagValue:false, trimValues:false, processEntities:false });
export function parseXml(body) {
  requireValue(!/<!DOCTYPE|<!ENTITY/i.test(body) && XMLValidator.validate(body)===true,'INVALID_XML','消息 XML 无效');
  const parsed=parser.parse(body);
  requireValue(parsed.xml && typeof parsed.xml==='object','INVALID_XML','消息缺少 xml 根节点');
  return parsed.xml;
}
// Mini Program URL verification signs token/timestamp/nonce and echoes the
// plaintext echostr. AES/msg_signature apply to subsequent POST notifications.
export function verifyPushUrl(config, query) {
  requireValue(typeof config.pushToken==='string' && /^[A-Za-z0-9]{3,32}$/.test(config.pushToken),'PAYMENT_NOT_CONFIGURED','消息推送 Token 尚未正确配置',503);
  requireValue(typeof query.signature==='string' && /^[a-f0-9]{40}$/.test(query.signature) && typeof query.timestamp==='string' && /^\d+$/.test(query.timestamp) && typeof query.nonce==='string' && query.nonce.length>0 && query.nonce.length<=256 && typeof query.echostr==='string' && query.echostr.length>0 && query.echostr.length<=1024,'INVALID_SIGNATURE','回调地址验证参数无效',401);
  const expected=createHash('sha1').update([config.pushToken,query.timestamp,query.nonce].sort().join('')).digest();
  requireValue(timingSafeEqual(Buffer.from(query.signature,'hex'),expected),'INVALID_SIGNATURE','消息签名错误',401);
  requireValue(Math.abs(Date.now()/1000-Number(query.timestamp))<600,'EXPIRED_SIGNATURE','消息签名已过期',401);
  return query.echostr;
}
export function decryptPush(config, query, encrypted) {
  requireValue(typeof encrypted === 'string' && typeof query.timestamp === 'string' && typeof query.nonce === 'string' && typeof query.msg_signature === 'string','INVALID_SIGNATURE','消息缺少安全模式签名',401);
  const expected = createHash('sha1').update([config.pushToken,query.timestamp,query.nonce,encrypted].sort().join('')).digest('hex');
  const received=Buffer.from(query.msg_signature,'hex'), expectedBytes=Buffer.from(expected,'hex');
  requireValue(received.length===expectedBytes.length && timingSafeEqual(received,expectedBytes),'INVALID_SIGNATURE','消息签名错误',401);
  requireValue(Math.abs(Date.now()/1000-Number(query.timestamp))<600,'EXPIRED_SIGNATURE','消息签名已过期',401);
  const key=Buffer.from(config.pushAesKey+'=','base64');
  const decipher=createDecipheriv('aes-256-cbc',key,key.subarray(0,16)); decipher.setAutoPadding(false);
  const padded=Buffer.concat([decipher.update(encrypted,'base64'),decipher.final()]);
  const pad=padded[padded.length-1];
  requireValue(pad>0 && pad<=32 && padded.subarray(-pad).every(v=>v===pad),'INVALID_MESSAGE','消息填充错误',401);
  const plain=padded.subarray(0,-pad);
  requireValue(plain.length>=20,'INVALID_MESSAGE','消息长度错误',401);
  const len=plain.readUInt32BE(16);
  requireValue(len<=plain.length-20 && plain.subarray(20+len).toString()===config.appId,'APPID_MISMATCH','消息 AppID 错误',401);
  return plain.subarray(20,20+len).toString();
}
export class WeChat {
  constructor(config, fetcher=fetch) { this.config=config; this.fetcher=fetcher; this.cachedToken=null; this.tokenPromise=null; }
  async json(url, options={}) {
    let response;
    try { response=await this.fetcher(url,{...options,signal:AbortSignal.timeout(12000)}); }
    catch(error) { throw new AppError('WECHAT_NETWORK','微信服务暂时无法连接，请稍后重试',502,{cause:error}); }
    requireValue(response.ok,'WECHAT_HTTP',`微信接口 HTTP ${response.status}`,502);
    const data=await response.json();
    if(data.errcode) {
      const providerMessage=typeof data.errmsg==='string'?data.errmsg:'';
      throw Object.assign(new AppError('WECHAT_'+data.errcode,`微信接口错误 ${data.errcode}：${providerMessage}`,502),{
        providerCode:data.errcode,providerMessage,providerRequestId:/\brid:\s*([a-f0-9-]+)/i.exec(providerMessage)?.[1]
      });
    }
    return data;
  }
  async login(code) {
    const url=new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search=new URLSearchParams({appid:this.config.appId,secret:this.config.appSecret,js_code:code,grant_type:'authorization_code'}).toString();
    const data=await this.json(url);
    requireValue(data.openid && data.session_key,'WECHAT_LOGIN','微信未返回有效登录状态',502);
    return data;
  }
  async accessToken() {
    if(this.cachedToken && this.cachedToken.until>Date.now()) return this.cachedToken.value;
    if(this.tokenPromise) return this.tokenPromise;
    this.tokenPromise=(async()=>{
      const data=await this.json('https://api.weixin.qq.com/cgi-bin/stable_token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'client_credential',appid:this.config.appId,secret:this.config.appSecret})});
      requireValue(data.access_token && data.expires_in>60,'WECHAT_TOKEN','微信凭据响应不完整',502);
      this.cachedToken={value:data.access_token,until:Date.now()+(data.expires_in-60)*1000};
      return data.access_token;
    })();
    try{return await this.tokenPromise;}finally{this.tokenPromise=null;}
  }
  async xpay(uri, payload, requestId) {
    const body=JSON.stringify(payload), url=new URL('https://api.weixin.qq.com'+uri);
    const trace={requestId,operation:uri,orderId:payload.order_id,env:payload.env};
    // Every XPay server request is signed, including delivery acknowledgement.
    // No unsigned mode: the endpoint's abbreviated parameter table does not
    // override the common payment signature contract.
    try {
      requireValue(typeof this.config.appKey==='string' && this.config.appKey.length>0,'PAYMENT_NOT_CONFIGURED','支付签名密钥未配置',503);
      url.searchParams.set('pay_sig',paySignature(this.config.appKey,uri,body));
      url.searchParams.set('access_token',await this.accessToken());
      log('wechat.xpay.started',trace);
      const result=await this.json(url,{method:'POST',headers:{'content-type':'application/json'},body});
      log('wechat.xpay.completed',{...trace,providerCode:result.errcode || 0});
      return result;
    } catch(error) {
      error.operation=uri;
      log('wechat.xpay.failed',{...trace,code:error.code || 'INTERNAL',providerRequestId:error.providerRequestId},'error');
      throw error;
    }
  }
  async query(order,requestId) { return (await this.xpay('/xpay/query_order',{openid:order.user_id,env:0,order_id:order.id},requestId)).order; }
  async deliver(order,requestId) { return this.xpay('/xpay/notify_provide_goods',{order_id:order.id,env:0},requestId); }
}
