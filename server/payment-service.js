import { requireValue, log } from './errors.js';

export class PaymentService {
  constructor(store, wechat) { this.store=store; this.wechat=wechat; this.running=false; }
  async sync(order,requestId,fromPush=false) {
    const remote=await this.wechat.query(order,requestId);
    requireValue(remote && remote.order_id===order.id && remote.env_type===1,'PAYMENT_MISMATCH','微信查单数据不一致',409);
    this.store.db.prepare('UPDATE orders SET last_checked=? WHERE id=?').run(this.store.now(),order.id);
    if([2,3,4].includes(remote.status)) {
      requireValue(remote.left_fee===undefined || (Number.isInteger(remote.left_fee) && remote.left_fee>=0 && remote.left_fee<=order.price),'PAYMENT_MISMATCH','微信订单剩余金额异常',409);
      if(remote.left_fee!==undefined && remote.left_fee<order.price) {
        return this.store.refund(order.id,order.price-remote.left_fee,requestId);
      }
      const fulfilled=this.store.fulfill(order.id,remote,requestId);
      if(fromPush || remote.status===4) {
        this.store.db.prepare('UPDATE orders SET delivered=1 WHERE id=?').run(order.id);
      } else if(!fulfilled.delivered) {
        // Persist entitlement before notifying WeChat. If the network fails, the next reconciliation retries only the acknowledgment.
        await this.wechat.deliver(fulfilled,requestId);
        this.store.db.prepare('UPDATE orders SET delivered=1 WHERE id=?').run(order.id);
      }
      log('payment.confirmed',{requestId,orderId:order.id,wxOrderId:remote.wx_order_id});
    } else if(remote.status===6 && order.status==='created') {
      this.store.db.prepare("UPDATE orders SET status='closed' WHERE id=? AND status='created'").run(order.id);
    }
    return this.store.order(order.id);
  }
  async reconcile() {
    if(this.running) return {skipped:true,checked:0,failed:0};
    this.running=true;
    try {
      const now=this.store.now();
      const rows=this.store.db.prepare(`SELECT * FROM orders WHERE
        (status='created' AND created_at>? AND last_checked<?) OR
        (status='paid' AND delivered=0 AND last_checked<?) OR
        (status='paid' AND created_at>? AND last_checked<?)
        ORDER BY last_checked,created_at LIMIT 100`).all(now-2*86400000,now-240000,now-240000,now-180*86400000,now-86400000);
      const failures=[];
      for(const row of rows) {
        try { await this.sync(row,'reconcile'); }
        catch(error) {
          this.store.db.prepare('UPDATE orders SET last_checked=? WHERE id=?').run(now,row.id);
          this.store.audit('payment.reconcile_failed',row.id,'reconcile',{code:error.code || 'INTERNAL'});
          log('payment.reconcile_failed',{orderId:row.id,code:error.code || 'INTERNAL'},'error');
          failures.push(error);
        }
      }
      log('payment.reconcile_completed',{checked:rows.length,failed:failures.length});
      if(failures.length)throw new AggregateError(failures,`${failures.length} of ${rows.length} payment reconciliations failed`);
      return {skipped:false,checked:rows.length,failed:0};
    } finally {this.running=false;}
  }
}
