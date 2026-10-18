import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHandler } from '../cloud/handler.js';
import { APP_ID } from '../cloud/config.js';

const ownId = 'test_caller_identity_12345678';
function fixture(mode = 'verification', context = { APPID: APP_ID, OPENID: ownId }) {
  const config = { mode, appId: APP_ID, testers: ['existing_tester'] };
  const handler = createHandler({ getWXContext: () => context }, {
    config, store: {}, files: {}, wechat: {}, segment: () => { throw new Error('Unexpected portrait call'); }
  });
  return { handler, config };
}

test('test identity uses only authenticated caller context and cannot enroll or access paid APIs', async () => {
  for (const mode of ['closed', 'development', 'verification']) {
    const { handler, config } = fixture(mode);
    const response = await handler({ path: '/api/identity', method: 'GET', data: { openid: 'existing_tester' }, OPENID: 'existing_tester' });
    assert.equal(response.ok, true);
    assert.deepEqual(response.data, { openid: ownId, mode });
    assert.match(response.requestId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(config.testers, ['existing_tester']);
    const deniedCode = mode === 'closed' ? 'CLOUD_SETUP' : 'DEVELOPMENT_ONLY';
    for (const [path, method] of [['/api/config', 'GET'], ['/api/me', 'GET'], ['/api/orders', 'POST'], ['/api/uploads', 'POST'], ['/api/tools/lottery', 'POST'], ['/api/identity', 'POST']]) {
      assert.equal((await handler({ path, method })).error.code, deniedCode);
    }
  }
});

test('identity is unavailable to unauthenticated, cross-app and production callers', async () => {
  for (const context of [{}, { APPID: APP_ID }, { APPID: 'other_app', OPENID: ownId }]) {
    const { handler } = fixture('verification', context);
    const response = await handler({ path: '/api/identity', APPID: APP_ID, OPENID: ownId });
    assert.equal(response.error.code, 'UNAUTHORIZED');
    assert.equal(response.data, undefined);
  }
  const { handler } = fixture('production');
  assert.equal((await handler({ path: '/api/identity' })).error.code, 'IDENTITY_UNAVAILABLE');
});

function pageFixture({ release = false, mode = 'verification', request } = {}) {
  let definition, calls = 0;
  const errors = [];
  const api = {
    authed: async path => { calls++; assert.equal(path, '/api/identity'); return request ? request() : { openid: ownId, mode }; },
    reportError: error => { errors.push(error); return { message: error.message }; }
  };
  vm.runInNewContext(readFileSync('miniprogram/pages/test-identity/index.js', 'utf8'), {
    Page: value => { definition = value; },
    require: name => name.endsWith('/api') ? api : { transport: 'cloud', mode },
    wx: { getAccountInfoSync: () => ({ miniProgram: { envVersion: release ? 'release' : 'develop' } }) }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData: function(value) { Object.assign(this.data, value); } };
  page.onLoad();
  return { page, errors, calls: () => calls };
}

test('identity page waits for user action, handles failures, and stays closed in release', async () => {
  const normal = pageFixture();
  assert.equal(normal.calls(), 0);
  await normal.page.identify();
  assert.equal(normal.page.data.openid, ownId);
  assert.equal(normal.page.data.loading, false);
  normal.page.onUnload();
  assert.equal(normal.page.data.openid, '');
  for (const result of [{ openid: '' }, { openid: ownId, mode: 'production' }]) {
    const invalid = pageFixture({ request: async () => result });
    await invalid.page.identify();
    assert.equal(invalid.page.data.openid, '');
    assert.equal(invalid.errors[0].code, 'IDENTITY_RESPONSE');
  }
  const failed = pageFixture({ request: async () => { throw new Error('Network unavailable'); } });
  await failed.page.identify();
  assert.equal(failed.page.data.errorInfo.message, 'Network unavailable');
  assert.equal(failed.page.data.loading, false);
  for (const options of [{ release: true }, { mode: 'production' }]) {
    const disabled = pageFixture(options);
    await disabled.page.identify();
    assert.equal(disabled.calls(), 0);
  }
});
