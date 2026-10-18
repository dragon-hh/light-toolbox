const config = require('../../config');
const consent = require('../../utils/processing-consent');
const api = require('../../utils/api');
Page({
  data: { cloud: config.transport === 'cloud', accepted: false, consentError: '', consentInfo: null, details: { processing: false, retention: false, account: false } },
  onShow() { this.refreshConsent(); },
  toggleDetails(event) { const section = event.currentTarget.dataset.section; if (!Object.prototype.hasOwnProperty.call(this.data.details, section)) throw new Error('无法识别说明栏目'); this.setData({ details: Object.assign({}, this.data.details, { [section]: !this.data.details[section] }) }); },
  consentFailure(error, operation) { const info = api.reportError(error, { operation }); this.setData({ consentError: info.message, consentInfo: info }); },
  refreshConsent() {
    try { this.setData({ accepted: consent.isAccepted(), consentError: '' }); }
    catch (error) { this.setData({ accepted: false }); this.consentFailure(error, 'privacy.read'); }
  },
  acceptConsent() {
    try { consent.accept(); this.refreshConsent(); wx.showToast({ title: '已记住你的确认' }); }
    catch (error) { this.setData({ accepted: false }); this.consentFailure(error, 'privacy.accept'); }
  },
  revokeConsent() {
    try { consent.revoke(); this.refreshConsent(); wx.showToast({ title: '已撤回处理同意', icon: 'none' }); }
    catch (error) { this.consentFailure(error, 'privacy.revoke'); }
  },
  openPrivacyContract() { if (wx.openPrivacyContract) wx.openPrivacyContract({ fail: error => wx.showModal({ title: '暂时无法打开', content: error.errMsg, showCancel: false }) }); }
});
