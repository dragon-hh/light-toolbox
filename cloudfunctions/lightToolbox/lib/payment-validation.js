import { requireValue } from './shared/errors.js';

export function validatePayment(order,remote) {
  requireValue(remote && remote.order_id===order.id && remote.env_type===1 && [0,7].includes(remote.order_type),'PAYMENT_MISMATCH','微信查单数据不一致',409);
  requireValue([2,3,4].includes(remote.status) && remote.order_fee===order.price && remote.paid_fee===order.price,'PAYMENT_MISMATCH','微信支付状态或金额不一致',409);
  requireValue(typeof remote.wx_order_id==='string' && remote.wx_order_id.length>0 && (!order.wx_id || order.wx_id===remote.wx_order_id),'PAYMENT_MISMATCH','微信平台订单不一致',409);
  requireValue(remote.left_fee===undefined || Number.isInteger(remote.left_fee) && remote.left_fee>=0 && remote.left_fee<=order.price,'PAYMENT_MISMATCH','微信订单剩余金额异常',409);
}
