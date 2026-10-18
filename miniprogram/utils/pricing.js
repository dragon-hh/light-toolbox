function formatPrice(fen) {
  if (!Number.isSafeInteger(fen) || fen < 100 || fen > 2147483647) throw new Error('套餐价格无效，请刷新后重试');
  return (fen / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function presentPrices(prices) {
  if (!prices || !prices.single || !prices.month) throw new Error('未能获取套餐价格，请刷新后重试');
  return {
    single: { price: prices.single.price, label: formatPrice(prices.single.price) },
    month: { price: prices.month.price, label: formatPrice(prices.month.price), daily: (prices.month.price / 100 / 30).toFixed(2) }
  };
}
const pricingCore = { formatPrice, presentPrices };
if (typeof module !== 'undefined') module.exports = pricingCore;
else globalThis.LightPricing = pricingCore;
