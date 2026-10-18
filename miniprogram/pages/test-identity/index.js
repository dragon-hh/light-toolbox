const api = require('../../utils/api');
const config = require('../../config');

Page({
  data: { loading: false, openid: '', errorInfo: null, ready: false },
  onLoad() {
    const testBuild = config.transport === 'cloud' && ['closed', 'development', 'verification'].includes(config.mode);
    const preview = wx.getAccountInfoSync().miniProgram.envVersion !== 'release';
    this.setData({ ready: testBuild && preview });
  },
  async identify() {
    if (!this.data.ready || this.data.loading) return;
    this.setData({ loading: true, openid: '', errorInfo: null });
    try {
      const result = await api.authed('/api/identity');
      if (!result || typeof result.openid !== 'string' || !/^[A-Za-z0-9_-]{10,128}$/.test(result.openid) || !['closed', 'development', 'verification'].includes(result.mode)) {
        throw Object.assign(new Error('账号识别返回异常，请重试'), { code: 'IDENTITY_RESPONSE' });
      }
      // Show only to this caller. Do not persist, log, or copy the identifier.
      this.setData({ openid: result.openid });
    } catch (error) {
      this.setData({ errorInfo: api.reportError(error, { operation: 'test.identify' }) });
    } finally {
      this.setData({ loading: false });
    }
  },
  onUnload() { this.setData({ openid: '' }); }
});
