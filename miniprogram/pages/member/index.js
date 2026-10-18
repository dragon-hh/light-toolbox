const api = require('../../utils/api');
const { purchase } = require('../../utils/payment');
const { presentPrices } = require('../../utils/pricing');
const { dateTime } = require('../../utils/presentation');
const session = require('../../utils/tool-session');
const states = { created: '待支付 / 待确认', paid: '已到账', refunded: '已退款', refund_review: '退款待核对', closed: '已关闭' };
Page({
  data: { profile: null, orders: [], prices: null, loading: false, busy: false, agreed: false, sku: 'month', error: '', local: api.config.mode === 'local' || api.config.mode === 'development', memberDate: '', renewalDate: '', returnTarget: null, checkoutOpen: false, ordersOpen: false, orderDetailId: '', errorInfo: null },
  onShow() {
    if (this.getTabBar()) this.getTabBar().setData({ selected: 2 });
    if (!this.data.busy) this.setData({ checkoutOpen: false, agreed: false });
    this.load();
  },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    const sequence = (this.loadSequence || 0) + 1;
    this.loadSequence = sequence;
    const previous = this.data.prices;
    this.setData({ loading: true, prices: null, returnTarget: session.getReturn() });
    try {
      const values = await Promise.all([api.authed('/api/me'), api.authed('/api/orders'), api.request('/api/config')]);
      if (sequence !== this.loadSequence) return;
      const prices = presentPrices(values[2].prices);
      const changed = !previous || previous.single.price !== prices.single.price || previous.month.price !== prices.month.price;
      const profile = values[0];
      const activated = profile.isMember && !(this.data.profile && this.data.profile.isMember);
      const entitlementChanged = !this.data.profile || profile.isMember !== this.data.profile.isMember || profile.memberUntil !== this.data.profile.memberUntil;
      this.setData({
        prices, local: values[2].mode === 'local' || values[2].mode === 'development',
        profile, memberDate: profile.isMember ? dateTime(profile.memberUntil) : '',
        renewalDate: profile.isMember ? dateTime(profile.memberUntil + 30 * 86400000) : '',
        sku: profile.isMember ? 'month' : this.data.sku,
        checkoutOpen: activated ? false : this.data.checkoutOpen,
        agreed: changed || entitlementChanged ? false : this.data.agreed,
        orders: values[1].map(order => Object.assign({}, order, { name: order.sku === 'month' ? '30天工具箱月卡' : '单次使用权', priceLabel: (order.price / 100).toFixed(2), stateLabel: states[order.status], date: dateTime(order.created_at) })), error: ''
      });
    } catch (error) { if (sequence !== this.loadSequence) return; const info = api.reportError(error, { operation: 'member.load' }); this.setData({ prices: null, agreed: false, error: info.message, errorInfo: info }); }
    finally { if (sequence === this.loadSequence) this.setData({ loading: false }); }
  },
  select(event) { if (!this.data.busy) this.setData({ sku: event.currentTarget.dataset.sku, agreed: false }); },
  toggleRenewal() {
    if (this.data.busy) return;
    const checkoutOpen = !this.data.checkoutOpen;
    this.setData({ checkoutOpen, sku: 'month', agreed: false }, () => {
      if (checkoutOpen) wx.pageScrollTo({ selector: '#purchase', duration: 200, fail: api.showError });
    });
  },
  toggleOrderDetails(event) { const id = event.currentTarget.dataset.id; this.setData({ orderDetailId: this.data.orderDetailId === id ? '' : id }); },
  toggleOrders() { this.setData({ ordersOpen: !this.data.ordersOpen }); },
  useTools() {
    if (this.data.returnTarget) this.resumeTool();
    else wx.switchTab({ url: '/pages/home/index', fail: api.showError });
  },
  agree(event) { this.setData({ agreed: event.detail.value.includes('yes') }); },
  async buy() {
    if (this.data.busy) return;
    if (this.data.loading || !this.data.prices) return api.showError(new Error('请等待套餐价格加载完成后再购买'));
    if (this.data.profile && this.data.profile.isMember && !this.data.checkoutOpen) return api.showError(new Error('请先打开续期月卡并确认购买说明'));
    if (!this.data.agreed) return api.showError(new Error('请先确认购买说明'));
    this.setData({ busy: true });
    try { await purchase(this.data.sku, this.data.prices[this.data.sku].price); wx.showToast({ title: '权益已到账' }); this.setData({ checkoutOpen: false, agreed: false }); await this.load(); }
    catch (error) { api.showError(error); this.setData({ ordersOpen: true }); await this.load(); }
    finally { this.setData({ busy: false }); }
  },
  async syncOrder(event) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try { const result = await api.authed('/api/orders/' + event.currentTarget.dataset.id + '/sync', 'POST', {}); wx.showToast({ title: result.status === 'paid' ? '权益已到账' : '已同步，尚未到账', icon: 'none' }); await this.load(); }
    catch (error) { api.showError(error); }
    finally { this.setData({ busy: false }); }
  },
  resumeTool() { const target = this.data.returnTarget; if (target) wx.navigateTo({ url: target.url, success: () => { session.clearReturn(); this.setData({ returnTarget: null }); }, fail: api.showError }); },
  copyOrder(event) { const orderId = event.currentTarget.dataset.id; wx.setClipboardData({ data: orderId, fail: error => api.showError(error, { operation: 'member.copyOrder', orderId }) }); },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }); }
});
