import { requireValue, log } from '../server/errors.js';

import { validatePayment } from './payment-validation.js';

export class CloudPayments {
  constructor(store,wechat) {this.store=store;this.wechat=wechat;}
  async sync(order,requestId,fromPush=false) {
    let remote;
    try {remote=await this.wechat.query(order,requestId);}
    catch(error) {
      // A locally signed order is not registered in WeChat until the client
      // starts payment. The same error number is also used for signature errors,
      // so only the observed "data does not exist" response is pending. All
      // other messages (and any previously paid order) remain hard failures.
      const missing=error.code==='WECHAT_268490002' && /^数据不存在(?:\s+rid:\s*[a-f0-9-]+)?\s*$/i.test(error.providerMessage || '');
      if(!missing || order.status!=='created' || order.wx_id)throw error;
      const current=await this.store.order(order.id);
      if(current.status!=='created' || current.wx_id)throw error;
      await this.store.updateOrder(order.id,{last_checked:this.store.now(),platform_state:'not_registered',platform_error_code:error.code});
      log('cloud.payment.not_registered',{requestId,orderId:order.id,code:error.code},'warn');
      return this.store.order(order.id);
    }
    requireValue(remote && remote.order_id===order.id && remote.env_type===1,'PAYMENT_MISMATCH','微信查单数据不一致',409);
    await this.store.updateOrder(order.id,{last_checked:this.store.now(),platform_state:'found',platform_error_code:null});
    if([2,3,4].includes(remote.status)) {
      validatePayment(order,remote);
      if(remote.left_fee!==undefined && remote.left_fee<order.price) {
        const refunded=await this.store.refund(order.id,order.price-remote.left_fee,remote);
        log('cloud.payment.refund_confirmed',{requestId,orderId:order.id,refundAmount:order.price-remote.left_fee});
        return refunded;
      }
      const paid=await this.store.fulfill(order.id,remote);
      log('cloud.payment.entitlement_confirmed',{requestId,orderId:order.id,delivered:paid.delivered});
      if(fromPush || remote.status===4)await this.store.updateOrder(order.id,{delivered:true});
      else if(!paid.delivered) {await this.wechat.deliver(paid,requestId);await this.store.updateOrder(order.id,{delivered:true});}
      log('cloud.payment.confirmed',{requestId,orderId:order.id});
    }
    // A terminal unpaid status is display-only: no entitlement is granted.
    return this.store.order(order.id);
  }
  async confirmRefund(order,amount,requestId) {
    requireValue(Number.isInteger(amount) && amount>0 && amount<=order.price,'REFUND_AMOUNT','退款金额无效',409);
    const remote=await this.wechat.query(order,requestId);
    validatePayment(order,remote);
    // Query the original payment order. Refund-order status 5/8 is not a paid
    // order; left_fee is the platform's cumulative remaining payment balance.
    requireValue(Number.isInteger(remote.left_fee) && order.price-remote.left_fee>=amount,'REFUND_NOT_CONFIRMED','微信查单尚未确认退款',409);
    const refunded=await this.store.refund(order.id,order.price-remote.left_fee,remote);
    await this.store.updateOrder(order.id,{last_checked:this.store.now()});
    log('cloud.payment.refund_confirmed',{requestId,orderId:order.id,refundAmount:order.price-remote.left_fee});
    return refunded;
  }
  async reconcile() {
    const {db}=this.store, _=db.command, now=this.store.now();
    const rows=(await db.collection('light_orders').where(_.or([
      {status:'created',created_at:_.gt(now-2*86400000),last_checked:_.lt(now-240000)},
      {status:'paid',delivered:false,last_checked:_.lt(now-240000)},
      {status:'paid',created_at:_.gt(now-180*86400000),last_checked:_.lt(now-86400000)}
    ])).orderBy('last_checked','asc').limit(50).get()).data;
    const failures=[];
    for(const row of rows) {
      try {await this.sync(row,'timer');}
      catch(error) {
        await this.store.updateOrder(row.id,{last_checked:now});
        log('cloud.payment.reconcile_failed',{orderId:row.id,code:error.code || 'INTERNAL'},'error');failures.push(error);
      }
    }
    if(failures.length)throw new AggregateError(failures,'Cloud payment reconciliation partially failed');
    return {checked:rows.length};
  }
}
