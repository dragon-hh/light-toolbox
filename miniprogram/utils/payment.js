const api = require('./api');
const { formatPrice } = require('./pricing');
function compareVersion(version, minimum) {
  const a = version.split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) > (b[i] || 0)) return 1; if ((a[i] || 0) < (b[i] || 0)) return -1; }
  return 0;
}
async function purchase(sku, expectedPrice) {
  formatPrice(expectedPrice);
  if (!['production','verification'].includes(api.config.mode)) throw new Error('测试体验不发起支付，支付开放后可在微信真机购买');
  const device = wx.getDeviceInfo(), app = wx.getAppBaseInfo();
  if (device.platform === 'ios' && (compareVersion(app.version, '8.0.68') < 0 || compareVersion(device.system.replace(/^iOS\s*/i, ''), '15') < 0)) throw new Error('iOS 支付需要 iOS 15 及以上，且微信版本至少 8.0.68');
  if (typeof wx.requestVirtualPayment !== 'function' || !wx.canIUse('requestVirtualPayment')) throw new Error('当前客户端不支持虚拟支付，请更新微信');
  await api.login(true);
  const order = await api.authed('/api/orders', 'POST', { sku, platform: device.platform, expectedPrice });
  if (!order.payData || JSON.parse(order.payData.signData).goodsPrice !== expectedPrice) throw new Error('支付金额与页面价格不一致，已停止支付，请刷新后重试');
  let clientError;
  try { await new Promise((resolve, reject) => wx.requestVirtualPayment(Object.assign({}, order.payData, { success: resolve, fail: reject }))); }
  catch (error) { clientError = error; }
  // Even a cancelled/failed client call can race a paid server order. Query before reporting it.
  for (let attempt = 0; attempt < 6; attempt++) {
    const status = await api.authed('/api/orders/' + order.orderId + '/sync', 'POST', {});
    if (status.status === 'paid') return status;
    if (clientError) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (clientError && Number(clientError.errCode) === -2) throw new Error('你已取消支付；如已扣款，可在我的订单中同步状态');
  if (clientError) throw new Error('微信支付未确认完成（' + (clientError.errCode || '未知错误') + '）。如已扣款，请在我的订单同步状态');
  throw new Error('微信正在确认支付结果，请稍后在我的订单同步状态。请勿重复购买');
}
module.exports = { purchase, compareVersion };
