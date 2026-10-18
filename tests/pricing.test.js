import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { readPrices, quotedPrice, loadConfig } from '../server/config.js';
import { cloudConfig } from '../cloud/config.js';
import { Store } from '../server/store.js';

const env = { LIGHT_PRICE_SINGLE_FEN: '100', LIGHT_PRICE_MONTH_FEN: '110' };
function native(file, dependencies = {}, globals = {}) {
  const context = { module: { exports: {} }, require: name => {
    if (!(name in dependencies)) throw new Error('Unexpected dependency: ' + name);
    return dependencies[name];
  }, console, ...globals };
  vm.runInNewContext(readFileSync('miniprogram/' + file, 'utf8'), context);
  return context.module.exports;
}
const pricing = native('utils/pricing.js');
const presentation = native('utils/presentation.js');

test('prices require explicit integer fen configuration without defaults or coercion', () => {
  assert.throws(() => readPrices({}), { code: 'CONFIG' });
  for (const value of [undefined, '', '99', '1.1', '110.0', '1e2', '-100', '0', ' 110', '0110', '2147483648', 110]) {
    assert.throws(() => readPrices({ ...env, LIGHT_PRICE_MONTH_FEN: value }), { code: 'CONFIG' });
  }
  assert.equal(loadConfig({ APP_MODE: 'local', ...env }).prices.month.price, 110);
  assert.equal(cloudConfig({ LIGHT_MODE: 'development', LIGHT_TEST_OPENIDS: 'alice', ...env }).prices.month.price, 110);
  assert.throws(() => cloudConfig({ LIGHT_MODE: 'development', LIGHT_TEST_OPENIDS: 'alice' }), { code: 'CONFIG' });
  assert.equal(cloudConfig({}).prices, null);
});

test('server quote rejects stale, missing, forged and prototype SKU values', () => {
  const prices = readPrices(env);
  assert.equal(quotedPrice(prices, 'month', 110), 110);
  assert.throws(() => quotedPrice(prices, 'month', 990), { code: 'PRICE_CHANGED' });
  for (const value of [undefined, '110', 1.1, 0, NaN]) assert.throws(() => quotedPrice(prices, 'month', value), { code: 'PRICE_QUOTE_REQUIRED' });
  for (const sku of ['__proto__', 'constructor', 'unknown']) assert.throws(() => quotedPrice(prices, sku, 110), { code: 'INVALID_PRODUCT' });
});

test('local orders retain their own amount and thirty-day rights through repricing and refunds', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'light-prices-'));
  const store = new Store(path.join(dir, 'test.sqlite'), 'a'.repeat(64));
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.login('alice', 'synthetic-session');
  assert.throws(() => store.createOrder('alice', 'month', 'month-id'), { code: 'CONFIG' });
  const old = store.createOrder('alice', 'month', 'month-id', 990);
  const current = store.createOrder('alice', 'month', 'month-id', readPrices(env).month.price);
  const remote = order => ({ order_id: order.id, env_type: 1, order_type: 0, status: 2, order_fee: order.price, paid_fee: order.price, wx_order_id: 'wx-' + order.id, paid_time: Math.floor(Date.now() / 1000) });
  store.fulfill(old.id, remote(old), 'test'); store.fulfill(current.id, remote(current), 'test');
  assert.equal(store.order(old.id).price, 990); assert.equal(store.order(current.id).price, 110);
  assert.equal(store.memberUntil('alice'), remote(old).paid_time * 1000 + 60 * 86400000);
  store.refund(current.id, 110, 'test');
  assert.equal(store.memberUntil('alice'), remote(old).paid_time * 1000 + 30 * 86400000);
});

test('native price labels and daily amount come only from valid server prices', () => {
  const prices = pricing.presentPrices(readPrices(env));
  assert.equal(prices.month.label, '1.1'); assert.equal(prices.month.daily, '0.04'); assert.equal(prices.single.label, '1');
  assert.equal(pricing.formatPrice(1000), '10'); assert.equal(pricing.formatPrice(101), '1.01');
  assert.throws(() => pricing.presentPrices({})); assert.throws(() => pricing.formatPrice('110'));
});

test('native payment sends displayed quote and never opens payment after a stale or inconsistent response', async () => {
  let sent, calls = 0, error = null, signedPrice = 110;
  const api = { config: { mode: 'verification' }, login: async () => {}, authed: async (url, method, data) => {
    if (url.endsWith('/sync')) return { status: 'paid' };
    sent = data; if (error) throw error;
    return { orderId: 'test-order', payData: { signData: JSON.stringify({ goodsPrice: signedPrice }) } };
  } };
  const { purchase } = native('utils/payment.js', { './api': api, './pricing': pricing }, { wx: {
    getDeviceInfo: () => ({ platform: 'android' }), getAppBaseInfo: () => ({}), canIUse: () => true,
    requestVirtualPayment: options => { calls++; options.success(); }
  } });
  await purchase('month', 110); assert.equal(sent.expectedPrice, 110); assert.equal(calls, 1);
  error = Object.assign(new Error('价格变化'), { code: 'PRICE_CHANGED' });
  await assert.rejects(purchase('month', 990), { code: 'PRICE_CHANGED' }); assert.equal(calls, 1);
  error = null; signedPrice = 990;
  await assert.rejects(purchase('month', 110), /金额与页面价格不一致/); assert.equal(calls, 1);
});

test('member page refreshes price, clears consent after a change, and blocks purchase after failed loading', async () => {
  let page, prices = readPrices(env), failed = false, purchased = null;
  const errors = [];
  const api = { config: { mode: 'verification' }, request: async () => {
    if (failed) throw new Error('network unavailable'); return { mode: 'verification', prices };
  }, authed: async url => url === '/api/me' ? { credits: 1, isMember: false, id: 'test' } : [], showError: error => errors.push(error.message), reportError: error => ({message:error.message}) };
  native('pages/member/index.js', {
    '../../utils/api': api, '../../utils/pricing': pricing, '../../utils/presentation': presentation, '../../utils/tool-session': { getReturn: () => null },
    '../../utils/payment': { purchase: async (...args) => { purchased = args; } }
  }, { Page: definition => { page = definition; }, wx: { showToast: () => {} } });
  page.setData = values => Object.assign(page.data, values);
  await page.load(); assert.equal(page.data.prices.month.label, '1.1');
  page.data.agreed = true; await page.buy(); assert.deepEqual(purchased, ['month', 110]);
  prices = readPrices({ ...env, LIGHT_PRICE_MONTH_FEN: '990' });
  await page.load(); assert.equal(page.data.prices.month.label, '9.9'); assert.equal(page.data.agreed, false);
  failed = true; await page.load(); assert.equal(page.data.prices, null); assert.match(page.data.error, /network/);
  purchased = null; page.data.agreed = true; await page.buy(); assert.equal(purchased, null); assert.ok(errors.length);
});
