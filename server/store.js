import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { PRODUCTS, validPrice } from './config.js';
import { requireValue, AppError } from './errors.js';

const DAY = 86400000;
const sha = value => createHash('sha256').update(value).digest('hex');
export class Store {
  constructor(filename, encryptionKey, now = () => Date.now()) {
    this.db = new DatabaseSync(filename); this.now = now; this.key = Buffer.from(encryptionKey, 'hex');
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),secret TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),sku TEXT NOT NULL,product_id TEXT NOT NULL,price INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'created',wx_id TEXT UNIQUE,channel_id TEXT,created_at INTEGER NOT NULL,paid_at INTEGER,delivered INTEGER NOT NULL DEFAULT 0,last_checked INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id,created_at);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),tool TEXT NOT NULL,input_hash TEXT NOT NULL,status TEXT NOT NULL,grant_id TEXT REFERENCES orders(id),created_at INTEGER NOT NULL,finished_at INTEGER,result TEXT,error TEXT,UNIQUE(user_id,id));
      CREATE INDEX IF NOT EXISTS jobs_grant ON jobs(grant_id,status);
      CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),job_id TEXT NOT NULL REFERENCES jobs(id),filename TEXT NOT NULL,mime TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,order_id TEXT,request_id TEXT,detail TEXT,created_at INTEGER NOT NULL);
      PRAGMA user_version=1;`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  seal(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
  }
  unseal(value) {
    const b = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0,12));
    decipher.setAuthTag(b.subarray(-16));
    return Buffer.concat([decipher.update(b.subarray(12,-16)), decipher.final()]).toString('utf8');
  }
  login(userId, sessionKey) {
    const now = this.now(), token = randomBytes(32).toString('hex');
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO users VALUES(?,?)').run(userId, now);
      this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
      this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sha(token), userId, this.seal(sessionKey), now, now + 7*DAY);
    });
    return token;
  }
  session(token) {
    if (!token) return null;
    return this.db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(sha(token), this.now());
  }
  memberUntil(userId) {
    const months = this.db.prepare("SELECT paid_at FROM orders WHERE user_id=? AND sku='month' AND status='paid' ORDER BY paid_at,id").all(userId);
    return months.reduce((until, order) => Math.max(until, order.paid_at) + 30*DAY, 0);
  }
  availableGrant(userId) {
    return this.db.prepare(`SELECT o.id FROM orders o WHERE o.user_id=? AND o.status='paid' AND o.sku='single'
      AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.grant_id=o.id AND j.status IN ('processing','succeeded')) ORDER BY o.paid_at,o.id LIMIT 1`).get(userId);
  }
  profile(userId) {
    const memberUntil = this.memberUntil(userId);
    const credits = this.db.prepare(`SELECT count(*) AS n FROM orders o WHERE o.user_id=? AND o.status='paid' AND o.sku='single'
      AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.grant_id=o.id AND j.status IN ('processing','succeeded'))`).get(userId).n;
    return { credits, memberUntil, isMember: memberUntil > this.now(), id: sha(userId).slice(0,8).toUpperCase() };
  }
  createOrder(userId, sku, productId, price) {
    requireValue(Object.hasOwn(PRODUCTS, sku), 'INVALID_PRODUCT', '请选择有效商品');
    requireValue(validPrice(price), 'CONFIG', '订单价格必须为有效的整数分',500);
    const id = 'L' + randomBytes(15).toString('hex');
    this.db.prepare('INSERT INTO orders(id,user_id,sku,product_id,price,created_at) VALUES(?,?,?,?,?,?)').run(id,userId,sku,productId,price,this.now());
    return this.order(id);
  }
  order(id) { return this.db.prepare('SELECT * FROM orders WHERE id=?').get(id); }
  orders(userId) { return this.db.prepare('SELECT id,sku,price,status,created_at,paid_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(userId); }
  audit(event, orderId, requestId, detail = {}) {
    this.db.prepare('INSERT INTO events(event,order_id,request_id,detail,created_at) VALUES(?,?,?,?,?)').run(event,orderId || null,requestId || null,JSON.stringify(detail),this.now());
  }
  fulfill(id, remote, requestId) {
    return this.transaction(() => {
      const order = this.order(id);
      requireValue(order, 'ORDER_NOT_FOUND', '订单不存在',404);
      requireValue(remote.order_id === id && remote.env_type === 1 && [0,7].includes(remote.order_type), 'PAYMENT_MISMATCH', '微信订单身份或环境不一致',409);
      requireValue([2,3,4].includes(remote.status), 'PAYMENT_NOT_PAID', '订单尚未支付',409);
      requireValue(remote.order_fee === order.price && remote.paid_fee === order.price, 'PAYMENT_MISMATCH', '微信订单金额不一致',409);
      requireValue(typeof remote.wx_order_id === 'string' && remote.wx_order_id.length > 0, 'PAYMENT_MISMATCH', '微信平台单号缺失',409);
      requireValue(Number.isInteger(remote.paid_time) && remote.paid_time > 0 && remote.paid_time*1000 <= this.now()+300000, 'PAYMENT_MISMATCH', '微信支付时间异常',409);
      requireValue(!order.wx_id || order.wx_id === remote.wx_order_id, 'PAYMENT_MISMATCH', '微信平台单号不一致',409);
      if (order.status === 'paid') return order;
      requireValue(order.status === 'created', 'ORDER_STATE', '订单已关闭或退款，不可再次发放权益',409);
      const duplicate = this.db.prepare('SELECT id FROM orders WHERE wx_id=?').get(remote.wx_order_id);
      requireValue(!duplicate, 'DUPLICATE_PAYMENT', '同一微信订单不能重复发货',409);
      this.db.prepare("UPDATE orders SET status='paid',wx_id=?,channel_id=?,paid_at=? WHERE id=?").run(remote.wx_order_id,remote.channel_order_id || null,remote.paid_time*1000,id);
      this.audit('payment.fulfilled',id,requestId,{ wxOrderId:remote.wx_order_id, sku:order.sku });
      return this.order(id);
    });
  }
  refund(id, amount, requestId) {
    return this.transaction(() => {
      const order = this.order(id);
      requireValue(order, 'ORDER_NOT_FOUND','退款订单不存在',404);
      requireValue(Number.isInteger(amount) && amount>0 && amount<=order.price, 'REFUND_AMOUNT','退款金额异常',409);
      // Partial refunds suspend the relevant grant for manual resolution. Never silently retain access.
      const status = amount === order.price ? 'refunded' : 'refund_review';
      if (order.status === 'refunded') return order;
      this.db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,id);
      this.audit('payment.'+status,id,requestId,{ amount });
      return this.order(id);
    });
  }
  reserveJob(userId, id, tool, inputHash, local = false) {
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
      if (previous) {
        requireValue(previous.user_id === userId && previous.input_hash === inputHash && previous.tool === tool,'IDEMPOTENCY_CONFLICT','相同任务编号不能用于不同内容',409);
        if(previous.status === 'succeeded') {
          requireValue(previous.result && previous.finished_at>this.now()-3600000,'RESULT_EXPIRED','这个任务的结果已过期，请重新提交',410);
          return { existing: true, result: JSON.parse(previous.result) };
        }
        throw new AppError(previous.status === 'processing' ? 'JOB_PROCESSING' : 'JOB_FAILED', previous.status === 'processing' ? '任务正在处理，请到记录页查看' : '上次处理失败，请重新提交',409);
      }
      const active = this.db.prepare("SELECT count(*) AS n FROM jobs WHERE user_id=? AND status='processing'").get(userId).n;
      requireValue(active < 2,'TOO_MANY_JOBS','已有任务处理中，请稍后再试',429);
      let grant = null;
      if (!local && this.memberUntil(userId) <= this.now()) {
        grant = this.availableGrant(userId);
        requireValue(grant,'PAYMENT_REQUIRED','请先购买单次使用权或开通月卡',402);
      }
      this.db.prepare('INSERT INTO jobs(id,user_id,tool,input_hash,status,grant_id,created_at) VALUES(?,?,?,?,?,?,?)').run(id,userId,tool,inputHash,'processing',grant ? grant.id : null,this.now());
      return { existing: false };
    });
  }
  succeedJob(id, result, artifact) {
    this.transaction(() => {
      const job=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
      requireValue(job && job.status==='processing','JOB_STATE','任务状态异常',409);
      if (artifact) this.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?)').run(artifact.id,job.user_id,id,artifact.filename,artifact.mime,artifact.expiresAt);
      this.db.prepare("UPDATE jobs SET status='succeeded',result=?,finished_at=? WHERE id=?").run(JSON.stringify(result),this.now(),id);
    });
  }
  failJob(id, code) { this.db.prepare("UPDATE jobs SET status='failed',error=?,finished_at=? WHERE id=? AND status='processing'").run(code,this.now(),id); }
  recoverJobs() { return this.db.prepare("UPDATE jobs SET status='failed',error='PROCESS_INTERRUPTED',finished_at=? WHERE status='processing'").run(this.now()).changes; }
  jobs(userId) { return this.db.prepare('SELECT id,tool,status,created_at,finished_at,result,error FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(userId).map(j=>({...j,result:j.result && j.finished_at>this.now()-3600000 ? JSON.parse(j.result):null})); }
  close() { this.db.close(); }
}
