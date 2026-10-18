import { requireValue, log } from '../server/errors.js';

const EVENTS=['xpay_goods_deliver_notify','xpay_refund_notify'];
const identifier=value=>typeof value==='string' && value.length>0 && value.length<=128;

// Cloud-function pushes share the invocation surface with client calls. Treat
// their payload as a reconciliation hint, never proof of payment or refund.
// WX context (including SOURCE) can survive a warm invocation and is not used
// to authenticate callbacks. All entitlement changes require a platform query.
export async function handlePaymentNotification({message,config,store,payments,requestId,signedHttp=false}) {
  requireValue(['verification','production'].includes(config.mode),'PAYMENT_NOT_CONFIGURED','支付尚未开通',503);
  requireValue(message.MsgType==='event' && EVENTS.includes(message.Event),'UNHANDLED_PAYMENT_EVENT','未实现的支付消息类型',422);
  requireValue(message.ToUserName===config.originalId,'RECIPIENT_MISMATCH','消息接收者不匹配',401);
  requireValue(identifier(message.OpenId),'ORDER_MISMATCH','支付用户缺失',409);
  let order;
  if(message.Event==='xpay_goods_deliver_notify') {
    requireValue(identifier(message.OutTradeNo),'ORDER_MISMATCH','订单编号缺失',409);
    order=await store.order(message.OutTradeNo);
  } else {
    requireValue(Number(message.RetCode)===0 && message.RetCode!==null && message.RetCode!==undefined,'REFUND_NOT_COMPLETE','退款尚未完成',409);
    requireValue(identifier(message.MchOrderId),'ORDER_MISMATCH','退款订单编号缺失',409);
    order=await store.order(message.MchOrderId);
    if(!order) {
      const alternatives=[{channel_id:message.MchOrderId}];
      if(identifier(message.WxOrderId))alternatives.push({wx_id:message.WxOrderId});
      const matches=await store.db.collection('light_orders').where(store.db.command.or(alternatives)).limit(2).get();
      requireValue(matches.data.length===1,'ORDER_MISMATCH','退款订单无法唯一定位',409);
      order=matches.data[0];
    }
  }
  requireValue(order && order.user_id===message.OpenId,'ORDER_MISMATCH','支付订单或用户不匹配',409);
  requireValue(config.mode!=='verification' || config.testers.includes(order.user_id),'DEVELOPMENT_ONLY','当前仅向配置的测试账号开放',403);
  if(message.Event==='xpay_goods_deliver_notify') {
    const goods=message.GoodsInfo;
    requireValue((message.Env===0 || message.Env==='0') && goods && goods.ProductId===order.product_id && Number(goods.Quantity)===1 && Number(goods.ActualPrice)===order.price && Number(goods.OrigPrice)===order.price,'PRODUCT_MISMATCH','商品或金额不匹配',409);
    // Only a signed HTTP push can stand in for the delivery acknowledgement.
    // Native pushes must call notify_provide_goods after query_order confirms.
    requireValue((await payments.sync(order,requestId,signedHttp)).status==='paid','PAYMENT_NOT_PAID','微信尚未确认付款',409);
  } else {
    await payments.confirmRefund(order,Number(message.RefundFee),requestId);
  }
  log('cloud.payment.notification_confirmed',{requestId,orderId:order.id,eventType:message.Event,transport:signedHttp?'signed-http':'cloudfunction'});
  return {ErrCode:0,ErrMsg:'success'};
}
