const api = require('../../utils/api');
const wheel = require('../../utils/wheel');
const storage = require('../../utils/wheel-storage');
const renderer = require('../../utils/wheel-render');
const consent = require('../../utils/processing-consent');
const DURATION = 5200;
Page({
  data: { stage: 'edit', title: '', entries: [], weighted: false, busy: false, ready: false, fatal: false, canCancelEdit: false, error: '', errorInfo: null, consentInfo: null, profile: null, legendOpen: false, serviceError: '', serviceInfo: null, available: false, local: false, agreed: false, consentError: '', rotation: 0, duration: 0, wheelImage: '', result: null, pending: false, lights: Array.from({ length: 24 }, (_, i) => ({ id: i, angle: i * 15 })), confetti: Array.from({ length: 12 }, (_, i) => ({ id: i, left: 7 + i * 8, delay: i % 4 * 0.12, color: wheel.COLORS[i % 8] })) },
  onLoad() {
    this.syncConsent();
    try {
      this.saved = storage.load();
      const draft = this.saved ? this.saved.draft : wheel.defaults();
      wheel.validate(draft);
      const recent = this.saved && this.saved.last && Date.now() - this.saved.last.at < 3600000 ? this.saved.last : null;
      if (recent) wheel.validateResult(recent.result, draft.entries, recent.result.jobId);
      this.setData({ canCancelEdit: Boolean(this.saved), title: draft.title, weighted: draft.weighted, entries: wheel.decorate(draft.entries, draft.weighted), stage: this.saved ? 'spin' : 'edit', pending: Boolean(this.saved && this.saved.pending), result: recent ? this.presentResult(recent.result, draft.entries) : null, rotation: recent ? (360 - recent.result.winnerIndex * 360 / draft.entries.length) % 360 : 0 });
    } catch (error) { this.setData({ fatal: true }); this.fail(error, 'wheel.load'); }
    this.refreshAvailability();
  },
  async onReady() {
    if (this.data.fatal) return;
    try { await storage.cleanup(this.data.entries); }
    catch (error) { this.fail(error, 'wheel.cleanup'); return; }
    if (this.data.stage === 'spin') this.prepare();
  },
  onShow() { this.syncConsent(); if (this.hidden) { this.hidden = false; this.refreshAvailability(); } if (this.revealAt && Date.now() >= this.revealAt) this.reveal(); },
  onHide() { this.hidden = true; },
  onUnload() { clearTimeout(this.timer); this.unloaded = true; },
  async refreshAvailability() {
    try { const [config, profile] = await Promise.all([api.request('/api/config'), api.authed('/api/me')]); this.setData({ profile, serviceError: '', available: config.tools.some(t => t.id === 'lottery' && t.available), local: config.mode === 'local' || config.mode === 'development' }); }
    catch (error) { const info = api.reportError(error, { operation: 'wheel.availability' }); this.setData({ available: false, serviceError: info.message, serviceInfo: info }); }
  },
  fail(error, operation, jobId) {
    const info = api.reportError(error, { operation, jobId, returnTo: { url: '/pages/wheel/index', name: '幸运转盘' } });
    this.setData({ error: info.message, errorInfo: info }, () => wx.pageScrollTo({ selector: '#wheel-error', duration: 200, fail: e => console.error('[LIGHT] error.scroll', { message: e.errMsg }) }));
  },
  toggleLegend() { this.setData({ legendOpen: !this.data.legendOpen }); },
  draft() { return { title: this.data.title, weighted: this.data.weighted, entries: this.data.entries.map(e => ({ id: e.id, label: e.label, image: e.image, weight: e.weight })) }; },
  persist(value) { storage.save(value); this.saved = value; },
  updateEntries(entries) { this.setData({ entries: wheel.decorate(entries, this.data.weighted), error: '' }); },
  changeTitle(e) { if (!this.data.busy) this.setData({ title: e.detail.value }); },
  changeLabel(e) { if (this.data.busy) return; const entries = this.data.entries.slice(); entries[e.currentTarget.dataset.index] = Object.assign({}, entries[e.currentTarget.dataset.index], { label: e.detail.value }); this.updateEntries(entries); },
  changeWeight(e) { if (this.data.busy) return; const entries = this.data.entries.slice(); entries[e.currentTarget.dataset.index] = Object.assign({}, entries[e.currentTarget.dataset.index], { weight: e.detail.value }); this.updateEntries(entries); },
  changeWeighted(e) { if (this.data.busy) return; this.setData({ weighted: e.detail.value, entries: wheel.decorate(this.data.entries, e.detail.value) }); },
  addEntry() { if (this.data.busy || this.data.entries.length >= 8) return; this.updateEntries(this.data.entries.concat({ id: api.uuid(), label: '', image: '', weight: 1 })); },
  removeEntry(e) { if (this.data.busy || this.data.entries.length <= 2) return; this.updateEntries(this.data.entries.filter((_, i) => i !== e.currentTarget.dataset.index)); },
  moveEntry(e) {
    if (this.data.busy) return;
    const i = e.currentTarget.dataset.index, j = i + e.currentTarget.dataset.direction, entries = this.data.entries.slice();
    if (j < 0 || j >= entries.length) return;
    const entry = entries[i]; entries[i] = entries[j]; entries[j] = entry; this.updateEntries(entries);
  },
  async chooseImage(e) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (wx.requirePrivacyAuthorize) await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }));
      const chosen = await new Promise((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'], sizeType: ['compressed'], success: resolve, fail: reject }));
      const file = chosen.tempFiles[0];
      if (file.size > 3 * 1048576) throw new Error('请选择 3MB 以内的选项图片');
      await new Promise((resolve, reject) => wx.getImageInfo({ src: file.tempFilePath, success: resolve, fail: reject }));
      const path = await storage.importImage(file.tempFilePath, api.uuid()), entries = this.data.entries.slice(), i = e.currentTarget.dataset.index;
      entries[i] = Object.assign({}, entries[i], { image: path }); this.updateEntries(entries);
      // Keep the saved draft while editing, but discard superseded unsaved images.
      await storage.cleanup(entries.concat(this.saved ? this.saved.draft.entries : []));
    } catch (error) { if (!/cancel/.test(error.errMsg || '')) api.showError(error); }
    finally { this.setData({ busy: false }); }
  },
  async saveDraft() {
    if (this.data.busy || this.data.fatal) return;
    try {
      const draft = this.draft(); wheel.validate(draft);
      this.setData({ busy: true, error: '' });
      this.persist({ draft, pending: null, last: null });
      await storage.cleanup(draft.entries);
      this.setData({ canCancelEdit: true, stage: 'spin', result: null, rotation: 0, duration: 0, pending: false, ready: false });
      await this.renderWheel();
      wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    } catch (error) { this.fail(error, 'wheel.save'); }
    finally { this.setData({ busy: false }); }
  },
  async renderWheel() { const wheelImage = await renderer.render(this, this.data.entries); this.setData({ wheelImage, ready: true }); },
  async prepare() {
    this.setData({ busy: true, ready: false });
    try { await this.renderWheel(); this.setData({ error: '' }); }
    catch (error) { this.fail(error, 'wheel.render'); }
    finally { this.setData({ busy: false }); }
  },
  edit() { if (this.data.busy || this.data.pending) return; this.setData({ stage: 'edit', result: null, error: '' }); wx.pageScrollTo({ scrollTop: 0, duration: 200 }); },
  async cancelEdit() {
    if (this.data.busy || !this.saved) return;
    const draft = this.saved.draft;
    const recent = this.saved.last && Date.now() - this.saved.last.at < 3600000 ? this.saved.last : null;
    this.setData({ title: draft.title, weighted: draft.weighted, entries: wheel.decorate(draft.entries, draft.weighted), stage: 'spin', error: '', result: recent ? this.presentResult(recent.result, draft.entries) : null });
    await this.prepare();
  },
  syncConsent() {
    try { const agreed = consent.isAccepted(); this.setData({ agreed, consentError: '' }); return agreed; }
    catch (error) { const info = api.reportError(error, { operation: 'wheel.consent.read' }); this.setData({ agreed: false, consentError: info.message, consentInfo: info }); return false; }
  },
  agree(e) {
    if (this.data.busy) return;
    try { if (e.detail.value.includes('yes')) consent.accept(); else consent.revoke(); this.syncConsent(); }
    catch (error) { const info = api.reportError(error, { operation: 'wheel.consent' }); this.setData({ agreed: false, consentError: info.message, consentInfo: info }); }
  },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  presentResult(result, entries) { return Object.assign({}, result, { image: entries[result.winnerIndex].image }); },
  async spin() {
    if (this.data.busy || !this.data.ready || !this.data.available || this.data.fatal) return;
    if (!this.syncConsent()) return;
    this.setData({ busy: true, error: '', result: null });
    let jobId;
    try {
      const draft = this.saved.draft, payload = wheel.payload(draft);
      jobId = this.saved.pending ? this.saved.pending.jobId : api.uuid();
      // Save before sending. Lost responses and app restarts must reuse this job.
      this.persist({ draft, pending: { jobId }, last: null }); this.setData({ pending: true });
      console.info('[LIGHT] wheel.request', { jobId, entryCount: payload.entries.length });
      const result = await api.lottery(payload.entries, payload.title, jobId);
      wheel.validateResult(result, draft.entries, jobId);
      this.persist({ draft, pending: null, last: { result, at: Date.now() } });
      this.landedResult = this.presentResult(result, draft.entries);
      const rotation = wheel.landingAngle(this.data.rotation, result.winnerIndex, draft.entries.length);
      this.setData({ pending: false, duration: DURATION, rotation }, () => {
        this.revealAt = Date.now() + DURATION;
        this.timer = setTimeout(() => this.reveal(), DURATION + 80);
      });
      console.info('[LIGHT] wheel.landing', { jobId, winnerIndex: result.winnerIndex, rotation });
    } catch (error) {
      // Unknown/transport failures retain the exact request. Only definitive
      // failures or expiry permit creating a new job on the next explicit tap.
      if (['JOB_FAILED', 'RESULT_EXPIRED', 'PAYMENT_REQUIRED', 'INVALID_ENTRIES', 'INVALID_TITLE', 'INVALID_WEIGHT', 'DUPLICATE_ENTRIES'].includes(error.code)) {
        try { this.persist({ draft: this.saved.draft, pending: null, last: null }); this.setData({ pending: false }); }
        catch (saveError) { console.error('[LIGHT] wheel.pending.persist', { jobId, message: saveError.message }); this.setData({ fatal: true }); }
      }
      this.setData({ busy: false }); this.fail(error, 'wheel.spin', jobId);
    }
  },
  reveal() {
    if (!this.landedResult || this.unloaded) return;
    clearTimeout(this.timer); this.revealAt = null;
    this.setData({ result: this.landedResult, busy: false, duration: 0 }); this.landedResult = null;
    this.refreshAvailability();
    console.info('[LIGHT] wheel.revealed', { jobId: this.data.result.jobId });
  },
  onShareAppMessage() { return { title: '幸运转盘 · 配好选项，让好运登场', path: '/pages/wheel/index' }; }
});
