import { createHash, randomBytes } from 'node:crypto';
import { AppError, requireValue } from '../server/errors.js';
import { PRODUCTS, validPrice } from '../server/config.js';
import { COLLECTIONS, TTL } from './config.js';
import { validatePayment } from './payment-validation.js';

const DAY=86400000;
export const hash = value=>createHash('sha256').update(value).digest('hex');
const clean = document=>{ const {_id,...data}=document; return data; };

// The database only permits doc() operations within a transaction. Every change
// affecting entitlements also updates the user's revision. A pre-query snapshot
// is accepted inside a transaction only when that revision is still unchanged.
export class CloudStore {
  constructor(db, now=()=>Date.now()) { this.db=db;this.now=now; }
  ref(type,id,db=this.db) { return db.collection(COLLECTIONS[type]).doc(id); }
  async get(type,id,db=this.db) {
    const result=await this.ref(type,id,db).get();
    // Node SDK returns an array outside transactions and one object inside.
    // Never interpret a failed SDK envelope as a missing document.
    requireValue(!result.code,'DATABASE', '云数据库读取失败',500);
    return Array.isArray(result.data)?result.data[0] || null:result.data || null;
  }
  async put(type,id,data,db=this.db) { await this.ref(type,id,db).set(clean(data)); }
  async rows(type,where,limit=50) { return (await this.db.collection(COLLECTIONS[type]).where(where).orderBy('created_at','desc').limit(limit).get()).data; }
  async allOrders(userId) {
    const records=[]; let after='';
    for(;;) {
      const condition={user_id:userId}; if(after)condition._id=this.db.command.gt(after);
      const batch=(await this.db.collection(COLLECTIONS.orders).where(condition).orderBy('_id','asc').limit(100).get()).data;
      records.push(...batch); if(batch.length<100)return records;after=batch.at(-1)._id;
    }
  }
  async ensureUser(userId) {
    const id=hash(userId);
    await this.db.runTransaction(async tx=>{
      if(!await this.get('users',id,tx)) await this.put('users',id,{id,user_id:userId,revision:0,created_at:this.now(),last_order_at:0},tx);
    });
  }
  async snapshot(userId) {
    await this.ensureUser(userId);
    const user=await this.get('users',hash(userId));
    const orders=await this.allOrders(userId);
    const active=(await this.db.collection(COLLECTIONS.jobs).where({user_id:userId,status:'processing'}).limit(3).get()).data;
    return {user,orders,active};
  }
  async guard(tx,userId,snapshot) {
    const user=await this.get('users',hash(userId),tx);
    requireValue(user,'USER_NOT_FOUND','用户状态不存在',409);
    if(snapshot)requireValue(user.revision===snapshot.user.revision,'ACCOUNT_BUSY','权益状态刚刚变化，请刷新后重试',409);
    await this.put('users',user.id,{...user,revision:user.revision+1},tx);
    return user;
  }
  memberUntil(orders) {
    return orders.filter(o=>o.sku==='month' && o.status==='paid').sort((a,b)=>a.paid_at-b.paid_at || a.id.localeCompare(b.id)).reduce((until,o)=>Math.max(until,o.paid_at)+30*DAY,0);
  }
  async profile(userId) {
    const snapshot=await this.snapshot(userId);
    return this.db.runTransaction(async tx=>{
      await this.guard(tx,userId,snapshot);
      const memberUntil=this.memberUntil(snapshot.orders);
      return {id:hash(userId).slice(0,8).toUpperCase(),credits:snapshot.orders.filter(o=>o.sku==='single' && o.status==='paid' && !o.used_by).length,memberUntil,isMember:memberUntil>this.now()};
    });
  }
  async orders(userId) { return (await this.rows('orders',{user_id:userId})).map(({id,sku,price,status,created_at,paid_at})=>({id,sku,price,status,created_at,paid_at})); }
  order(id) { return this.get('orders',id); }
  async createOrder(userId,sku,productId,price) {
    requireValue(Object.hasOwn(PRODUCTS,sku),'INVALID_PRODUCT','请选择有效商品');
    requireValue(validPrice(price),'CONFIG','订单价格必须为有效的整数分',500);
    await this.ensureUser(userId);
    const id='L'+randomBytes(15).toString('hex'), now=this.now();
    return this.db.runTransaction(async tx=>{
      const user=await this.guard(tx,userId);
      requireValue(now-user.last_order_at>=10000,'RATE_LIMIT','请稍后再创建订单',429);
      await this.put('users',user.id,{...user,revision:user.revision+1,last_order_at:now},tx);
      const order={id,user_id:userId,sku,product_id:productId,price,status:'created',wx_id:null,channel_id:null,created_at:now,paid_at:null,delivered:false,last_checked:0,used_by:null};
      await this.put('orders',id,order,tx);return order;
    });
  }
  async fulfill(id,remote) {
    return this.db.runTransaction(async tx=>{
      const order=await this.get('orders',id,tx);
      requireValue(order,'ORDER_NOT_FOUND','订单不存在',404);
      requireValue(remote.order_id===id && remote.env_type===1 && [0,7].includes(remote.order_type),'PAYMENT_MISMATCH','微信订单身份或环境不一致',409);
      requireValue([2,3,4].includes(remote.status) && remote.order_fee===order.price && remote.paid_fee===order.price,'PAYMENT_MISMATCH','微信支付状态或金额不一致',409);
      requireValue(typeof remote.wx_order_id==='string' && remote.wx_order_id.length>0 && Number.isInteger(remote.paid_time) && remote.paid_time>0 && remote.paid_time*1000<=this.now()+300000,'PAYMENT_MISMATCH','微信平台单号或支付时间异常',409);
      requireValue(!order.wx_id || order.wx_id===remote.wx_order_id,'PAYMENT_MISMATCH','微信平台单号不一致',409);
      if(order.status==='paid')return order;
      requireValue(order.status==='created','ORDER_STATE','已关闭或退款的订单不可再次发放',409);
      const receiptId=hash(remote.wx_order_id);
      requireValue(!await this.get('receipts',receiptId,tx),'DUPLICATE_PAYMENT','同一微信订单不能重复发货',409);
      await this.guard(tx,order.user_id);
      await this.put('receipts',receiptId,{order_id:id,created_at:this.now()},tx);
      const paid={...order,status:'paid',wx_id:remote.wx_order_id,channel_id:remote.channel_order_id || null,paid_at:remote.paid_time*1000};
      await this.put('orders',id,paid,tx);return paid;
    });
  }
  async refund(id,amount,remote) {
    return this.db.runTransaction(async tx=>{
      const order=await this.get('orders',id,tx);
      requireValue(order,'ORDER_NOT_FOUND','退款订单不存在',404);
      // Revalidate against the latest transactional document: another invocation
      // may have fulfilled the order since the caller began its platform query.
      validatePayment(order,remote);
      requireValue(Number.isInteger(amount) && amount>0 && amount<=order.price,'REFUND_AMOUNT','退款金额异常',409);
      requireValue(Number.isInteger(remote.left_fee) && amount===order.price-remote.left_fee,'REFUND_NOT_CONFIRMED','微信查单尚未确认退款',409);
      if(order.status==='refunded')return order;
      await this.guard(tx,order.user_id);
      const next={...order,status:amount===order.price?'refunded':'refund_review'};
      await this.put('orders',id,next,tx);return next;
    });
  }
  async updateOrder(id,fields) { await this.ref('orders',id).update(fields); }
  async reserve(userId,id,tool,inputHash,development) {
    const snapshot=await this.snapshot(userId), now=this.now();
    return this.db.runTransaction(async tx=>{
      const previous=await this.get('jobs',id,tx);
      if(previous) {
        requireValue(previous.user_id===userId && previous.tool===tool && previous.input_hash===inputHash,'IDEMPOTENCY_CONFLICT','任务编号与内容不一致',409);
        if(previous.status==='succeeded') { requireValue(previous.result && previous.finished_at+TTL>now,'RESULT_EXPIRED','结果已过期',410);return {existing:true,result:previous.result}; }
        throw new AppError(previous.status==='processing'?'JOB_PROCESSING':'JOB_FAILED',previous.status==='processing'?'任务正在处理，请到记录查看':'任务已失败，请重新提交',409);
      }
      await this.guard(tx,userId,snapshot);
      requireValue(snapshot.active.length<2,'TOO_MANY_JOBS','已有任务处理中，请稍后再试',429);
      let grant=null;
      if(!development && this.memberUntil(snapshot.orders)<=now) {
        grant=snapshot.orders.filter(o=>o.sku==='single' && o.status==='paid' && !o.used_by).sort((a,b)=>a.paid_at-b.paid_at || a.id.localeCompare(b.id))[0];
        requireValue(grant,'PAYMENT_REQUIRED','请先购买使用次数或月卡',402);
        const current=await this.get('orders',grant.id,tx);
        requireValue(current.status==='paid' && !current.used_by,'ACCOUNT_BUSY','权益状态刚刚变化，请重试',409);
        await this.put('orders',grant.id,{...current,used_by:id},tx);
      }
      await this.put('jobs',id,{id,user_id:userId,tool,input_hash:inputHash,grant_id:grant?grant.id:null,status:'processing',created_at:now,finished_at:null,result:null,error:null},tx);
      return {existing:false};
    });
  }
  async finish(id,result,error=null) {
    await this.db.runTransaction(async tx=>{
      const job=await this.get('jobs',id,tx);
      requireValue(job && job.status==='processing','JOB_STATE','任务状态异常',409);
      await this.guard(tx,job.user_id);
      if(error && job.grant_id) {
        const grant=await this.get('orders',job.grant_id,tx);
        requireValue(grant && grant.used_by===id,'GRANT_STATE','使用次数记录异常',500);
        await this.put('orders',grant.id,{...grant,used_by:null},tx);
      }
      await this.put('jobs',id,{...job,status:error?'failed':'succeeded',finished_at:this.now(),result:result || null,error},tx);
    });
  }
  async jobs(userId) { return (await this.rows('jobs',{user_id:userId})).map(({id,tool,status,created_at,finished_at,result,error})=>({id,tool,status,created_at,finished_at,result:finished_at+TTL>this.now()?result:null,error})); }
}
