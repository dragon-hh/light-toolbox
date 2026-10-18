import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { requireValue } from './errors.js';

export function loadConfig(env = process.env) {
  const mode = env.APP_MODE || 'local';
  requireValue(['local', 'production'].includes(mode), 'CONFIG', 'APP_MODE must be local or production');
  const config = {
    mode, port: Number(env.PORT || 8787), dataDir: path.resolve(env.DATA_DIR || './data'),
    appId: env.WECHAT_APP_ID, appSecret: env.WECHAT_APP_SECRET,
    offerId: env.XPAY_OFFER_ID, appKey: env.XPAY_APP_KEY,
    products: { single: env.XPAY_PRODUCT_SINGLE, month: env.XPAY_PRODUCT_MONTH },
    iosEnabled: env.XPAY_IOS_ENABLED === 'true', pushToken: env.WECHAT_PUSH_TOKEN,
    pushAesKey: env.WECHAT_PUSH_AES_KEY, originalId: env.WECHAT_ORIGINAL_ID,
    encryptionKey: env.SESSION_ENCRYPTION_KEY,
    tencentId: env.TENCENT_SECRET_ID, tencentKey: env.TENCENT_SECRET_KEY,
    region: env.TENCENT_REGION || 'ap-guangzhou', artifactTtl: 60 * 60 * 1000
  };
  requireValue(Number.isInteger(config.port) && config.port > 0 && config.port < 65536, 'CONFIG', 'Invalid PORT');
  if (mode === 'production') {
    for (const key of ['appId', 'appSecret', 'offerId', 'appKey', 'pushToken', 'pushAesKey', 'originalId', 'encryptionKey']) {
      requireValue(config[key], 'CONFIG', `Missing production configuration: ${key}`);
    }
    requireValue(/^wx[a-f0-9]{16}$/.test(config.appId), 'CONFIG', 'Invalid WECHAT_APP_ID');
    requireValue(Object.values(config.products).every(Boolean), 'CONFIG', 'Configure both XPAY_PRODUCT_* IDs');
    requireValue(new Set(Object.values(config.products)).size === 2, 'CONFIG', 'Each SKU must have its own product ID');
    requireValue(/^[a-f0-9]{64}$/i.test(config.encryptionKey), 'CONFIG', 'SESSION_ENCRYPTION_KEY must be 32 random bytes in hex');
    requireValue(config.pushAesKey.length === 43, 'CONFIG', 'WECHAT_PUSH_AES_KEY must have 43 characters');
  } else if (!config.encryptionKey) {
    // Local sessions intentionally become invalid after a restart; no production secrets are generated.
    config.encryptionKey = randomBytes(32).toString('hex');
  }
  config.prices = readPrices(env);
  return config;
}
export const PRODUCTS = Object.freeze({
  single: Object.freeze({ name: '单次使用权', quantity: 1, kind: 'credit' }),
  month: Object.freeze({ name: '30天工具箱月卡', days: 30, kind: 'month' })
});

export function validPrice(price) {
  return Number.isSafeInteger(price) && price >= 100 && price <= 2147483647;
}
// Prices are operations configuration, never client constants or fallback values.
export function readPrices(env) {
  return Object.freeze(Object.fromEntries(Object.entries(PRODUCTS).map(([sku, product]) => {
    const key = 'LIGHT_PRICE_' + sku.toUpperCase() + '_FEN', raw = env[key];
    requireValue(typeof raw === 'string' && /^[1-9]\d*$/.test(raw) && validPrice(Number(raw)), 'CONFIG', key + ' must be an integer amount in fen (at least 100)', 500);
    return [sku, Object.freeze({ ...product, price: Number(raw) })];
  })));
}
export function quotedPrice(prices, sku, expectedPrice) {
  requireValue(Object.hasOwn(PRODUCTS, sku), 'INVALID_PRODUCT', '请选择有效商品');
  requireValue(validPrice(expectedPrice), 'PRICE_QUOTE_REQUIRED', '请重新打开最新版本小程序，加载套餐价格后再购买', 409);
  requireValue(prices && validPrice(prices[sku]?.price), 'CONFIG', '套餐价格尚未正确配置', 503);
  requireValue(expectedPrice === prices[sku].price, 'PRICE_CHANGED', '套餐价格已调整，请刷新页面并重新确认购买', 409);
  return prices[sku].price;
}
