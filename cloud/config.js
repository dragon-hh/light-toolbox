import { requireValue } from '../server/errors.js';
import { readPrices } from '../server/config.js';

export const ENV_ID = 'cloud1-6gjewz7jf1fbf260';
export const APP_ID = 'wx5492d17de04b205d';
export const COLLECTIONS = Object.freeze({ users:'light_users', orders:'light_orders', jobs:'light_jobs', receipts:'light_receipts', uploads:'light_uploads' });
export const TTL = 3600000;
export function cloudConfig(env = process.env) {
  const mode = env.LIGHT_MODE || 'closed';
  requireValue(['closed','development','verification','production'].includes(mode),'CONFIG','Invalid LIGHT_MODE',500);
  const config = {
    mode, appId:APP_ID, envId:ENV_ID, appSecret:env.WECHAT_APP_SECRET,maintenanceToken:env.LIGHT_MAINTENANCE_TOKEN,
    offerId:env.XPAY_OFFER_ID, appKey:env.XPAY_APP_KEY,
    products:{single:env.XPAY_PRODUCT_SINGLE,month:env.XPAY_PRODUCT_MONTH},
    iosEnabled:env.XPAY_IOS_ENABLED==='true', pushToken:env.WECHAT_PUSH_TOKEN,
    pushAesKey:env.WECHAT_PUSH_AES_KEY, originalId:env.WECHAT_ORIGINAL_ID,
    tencentId:env.TENCENT_SECRET_ID,tencentKey:env.TENCENT_SECRET_KEY,
    region:env.TENCENT_REGION || 'ap-guangzhou', artifactTtl:TTL,
    testers:(env.LIGHT_TEST_OPENIDS || '').split(',').map(x=>x.trim()).filter(Boolean)
  };
  if(['development','verification'].includes(mode)) requireValue(config.testers.length>0,'CONFIG','Testing requires LIGHT_TEST_OPENIDS',500);
  if(['production','verification'].includes(mode)) {
    for(const key of ['appSecret','offerId','appKey','pushToken','pushAesKey','originalId']) requireValue(config[key],'CONFIG','Missing '+key,500);
    requireValue(Object.values(config.products).every(Boolean) && config.products.single!==config.products.month,'CONFIG','Configure distinct payment products',500);
    requireValue(config.pushAesKey.length===43,'CONFIG','Invalid push AES key',500);
    // Deployment authorization is separate from payment acceptance evidence.
    // A deferred refund test must never be recorded as a passed payment test.
    if(mode==='production')requireValue(env.LIGHT_PRODUCTION_ENABLED==='true','PRODUCTION_SETUP','Production operation must be explicitly enabled',503);
  }
  config.prices = mode === 'closed' ? null : readPrices(env);
  return config;
}
