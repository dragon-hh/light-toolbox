const catalog = require('../../utils/catalog');
const api = require('../../utils/api');
const { presentPrices } = require('../../utils/pricing');
Page({
  data: { tools: catalog, prices: null, profile: null, loading: true, error: '', errorInfo: null, local: api.config.mode === 'local' || api.config.mode === 'development' },
  onShow() { if (this.getTabBar()) this.getTabBar().setData({ selected: 0 }); this.loadPrices(); },
  async onPullDownRefresh() { await this.loadPrices(); wx.stopPullDownRefresh(); },
  async loadPrices() {
    const sequence = (this.loadSequence || 0) + 1; this.loadSequence = sequence;
    this.setData({ prices: null, profile: null, loading: true, error: '', errorInfo: null });
    try {
      const [config, profile] = await Promise.all([api.request('/api/config'), api.authed('/api/me')]);
      if (sequence !== this.loadSequence) return;
      this.setData({ prices: presentPrices(config.prices), profile, local: config.mode === 'local' || config.mode === 'development' });
    } catch (error) {
      if (sequence !== this.loadSequence) return;
      const info = api.reportError(error, { operation: 'home.load' });
      this.setData({ prices: null, profile: null, error: info.message, errorInfo: info });
    } finally { if (sequence === this.loadSequence) this.setData({ loading: false }); }
  },
  openTool(event) { const id = event.currentTarget.dataset.id; wx.navigateTo({ url: id === 'lottery' ? '/pages/wheel/index' : '/pages/tool/index?id=' + id }); },
  openMember() { wx.switchTab({ url: '/pages/member/index' }); },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  onShareAppMessage() { return { title: 'LIGHT 的工具箱 · 让小事，轻一点', path: '/pages/home/index' }; }
});
