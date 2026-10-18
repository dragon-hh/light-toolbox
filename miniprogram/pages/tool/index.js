const catalog = require('../../utils/catalog');
const api = require('../../utils/api');
const session = require('../../utils/tool-session');
const { fileSize, entitlement } = require('../../utils/presentation');
const actions = require('../../utils/file-actions');
const consent = require('../../utils/processing-consent');
const imageFormat = require('../../utils/image-format');
const definitiveFailures = ['PAYMENT_REQUIRED','JOB_FAILED','RESULT_EXPIRED','INVALID_IMAGE','IMAGE_FORMAT','INVALID_QUALITY','PDF_COUNT','INVALID_PDF','PDF_TOO_LONG','EMPTY_PDF','NO_PORTRAIT','PHOTO_TOO_LARGE','PHOTO_OPTIONS','PHOTO_NOT_CONFIGURED','PORTRAIT_PROVIDER','FILE_COUNT','TOTAL_SIZE'];
function isCancel(error) { return /cancel/.test(error.errMsg || ''); }
Page({
  data: { tool: {}, files: [], size: 'one', background: 'blue', quality: 75, busy: false, saving: false, pending: false, result: null, resultPath: '', agreed: false, consentError: '', available: false, checking: true, profile: null, entitlementText: '', local: false, error: '', capabilityError: '', capabilityInfo: null, errorInfo: null, consentInfo: null, photoHelpOpen: false, outputFormat: '',
    sizes: [{ id: 'one', name: '一寸', dimensions: '295 × 413' }, { id: 'two', name: '二寸', dimensions: '413 × 579' }, { id: 'small', name: '小一寸', dimensions: '260 × 378' }],
    backgrounds: [{ id: 'blue', name: '蓝底', hex: '#438EDB' }, { id: 'white', name: '白底', hex: '#FFFFFF' }, { id: 'red', name: '红底', hex: '#D94141' }] },
  async onLoad(query) {
    this.unloaded = false;
    if (query.id === 'lottery') { wx.redirectTo({ url: '/pages/wheel/index' }); return; }
    const tool = catalog.find(item => item.id === query.id);
    if (!tool) { api.showError(new Error('工具不存在')); return; }
    const saved = session.load(tool.id);
    this.jobId = saved && saved.jobId;
    this.setData(Object.assign({}, saved || {}, { tool, busy: false, saving: false, pending: Boolean(this.jobId), agreed: false }));
    this.syncConsent();
    wx.setNavigationBarTitle({ title: tool.name });
    await this.refreshAvailability(); this.loaded = true;
  },
  onShow() { if (this.loaded) { this.syncConsent(); this.refreshAvailability(); } },
  onHide() { this.remember(this.data); },
  onUnload() { this.remember(this.data); this.unloaded = true; },
  remember(data) {
    if (!data.tool.id) return;
    const saved = { jobId: this.jobId || null };
    for (const key of ['files','size','background','quality','result','resultPath','error','errorInfo','outputFormat']) saved[key] = data[key];
    session.save(data.tool.id, saved);
  },
  update(patch, callback) {
    const data = Object.assign({}, this.data, patch); this.remember(data);
    if (this.unloaded) this.data = data; else this.setData(patch, callback);
  },
  async refreshAvailability() {
    this.update({ checking: true, capabilityError: '' });
    try {
      const [config, profile] = await Promise.all([api.request('/api/config'), api.authed('/api/me')]);
      const current = config.tools.find(t => t.id === this.data.tool.id), local = config.mode === 'local' || config.mode === 'development';
      this.update({ available: Boolean(current && current.available), local, profile, entitlementText: entitlement(Object.assign({}, profile, { local })) });
    } catch (error) { const info = api.reportError(error, { operation: 'tool.availability' }); this.update({ capabilityError: info.message, capabilityInfo: info, available: false }); }
    finally { this.update({ checking: false }); }
  },
  locked() { return this.data.busy || this.data.pending || Boolean(this.data.result); },
  togglePhotoHelp() { this.setData({ photoHelpOpen: !this.data.photoHelpOpen }); },
  invalidate() { this.jobId = null; this.update({ result: null, resultPath: '', error: '', errorInfo: null, pending: false }); },
  async chooseFiles() {
    if (this.locked()) return;
    try {
      if (wx.requirePrivacyAuthorize) await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }));
      if (this.data.tool.id === 'pdf') {
        const remaining = 10 - this.data.files.length;
        if (!remaining) throw new Error('最多添加 10 个 PDF');
        const selected = await new Promise((resolve, reject) => wx.chooseMessageFile({ count: remaining, type: 'file', extension: ['pdf'], success: resolve, fail: reject }));
        const files = this.data.files.concat(selected.tempFiles.map(file => ({ id: api.uuid(), path: file.path, name: file.name, size: file.size, sizeLabel: fileSize(file.size) })));
        if (files.some(f => f.size > 10 * 1048576) || files.reduce((n, f) => n + f.size, 0) > 40 * 1048576) throw new Error('单个 PDF 不能超过 10MB，总大小不能超过 40MB');
        this.invalidate(); this.update({ files });
      } else {
        const selected = await new Promise((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'], success: resolve, fail: reject }));
        const file = selected.tempFiles[0]; if (file.size > 10 * 1048576) throw new Error('请选择 10MB 以内的图片');
        const outputFormat = this.data.tool.id === 'compress' ? await imageFormat.forFile(file.tempFilePath) : '';
        this.invalidate(); this.update({ outputFormat, files: [{ id: api.uuid(), path: file.tempFilePath, name: '已选择图片', size: file.size, sizeLabel: fileSize(file.size) }] });
      }
    } catch (error) { if (!isCancel(error)) api.showError(error); }
  },
  removeFile(event) { if (this.locked()) return; this.invalidate(); this.update({ files: this.data.files.filter((_, index) => index !== event.currentTarget.dataset.index) }); },
  moveFile(event) {
    if (this.locked()) return;
    const index = event.currentTarget.dataset.index, target = index + event.currentTarget.dataset.direction, files = this.data.files.slice();
    if (target < 0 || target >= files.length) return;
    [files[index], files[target]] = [files[target], files[index]]; this.invalidate(); this.update({ files });
  },
  chooseSize(event) { if (this.locked()) return; this.invalidate(); this.update({ size: event.currentTarget.dataset.value }); },
  chooseBackground(event) { if (this.locked()) return; this.invalidate(); this.update({ background: event.currentTarget.dataset.value }); },
  changeQuality(event) { if (this.locked()) return; this.invalidate(); this.update({ quality: event.detail.value }); },
  syncConsent() {
    try { const agreed = consent.isAccepted(); this.update({ agreed, consentError: '' }); return agreed; }
    catch (error) { const info = api.reportError(error, { operation: 'tool.consent.read' }); this.update({ agreed: false, consentError: info.message, consentInfo: info }); return false; }
  },
  agree(event) {
    if (this.data.busy) return;
    try { if (event.detail.value.includes('yes')) consent.accept(); else consent.revoke(); this.syncConsent(); }
    catch (error) { const info = api.reportError(error, { operation: 'tool.consent' }); this.update({ agreed: false, consentError: info.message, consentInfo: info }); }
  },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  openMember() { this.remember(this.data); session.openMember({ url: '/pages/tool/index?id=' + this.data.tool.id, name: this.data.tool.name }); },
  openRecords() { wx.switchTab({ url: '/pages/records/index' }); },
  async run() {
    if (this.data.busy || this.data.result || this.data.checking || !this.data.available) return;
    const tool = this.data.tool.id;
    if (this.data.files.length < (tool === 'pdf' ? 2 : 1)) return api.showError(new Error(tool === 'pdf' ? '请先添加至少两个 PDF' : '请先选择一张图片'));
    if (!this.syncConsent()) return;
    if (!this.jobId && !this.data.local && this.data.profile && !this.data.profile.isMember && this.data.profile.credits < 1) { this.openMember(); return; }
    if (!this.jobId) this.jobId = api.uuid();
    const requestJobId = this.jobId;
    this.update({ busy: true, pending: true, result: null, resultPath: '', error: '' });
    console.info('[LIGHT] tool.request', { jobId: this.jobId, tool, fileCount: this.data.files.length });
    try {
      const result = await api.upload(tool, this.data.files.map(f => f.path), { quality: this.data.quality, size: this.data.size, background: this.data.background }, this.jobId);
      this.jobId = null;
      this.update({ pending: false, result: Object.assign({}, result, { outputSize: result.outputBytes ? fileSize(result.outputBytes) : '', originalSize: result.originalBytes ? fileSize(result.originalBytes) : '' }) }, () => {
        wx.pageScrollTo({ selector: '#tool-result', duration: 250, fail: error => console.error('[LIGHT] result.scroll', {message:error.errMsg}) });
      });
      if (result.artifact && result.artifact.mime !== 'application/pdf') await this.loadResultImage();
    } catch (error) {
      if (definitiveFailures.includes(error.code)) { this.jobId = null; this.update({ pending: false }); }
      const info = api.reportError(error, { operation: 'tool.run', jobId: requestJobId, returnTo: { url: '/pages/tool/index?id=' + tool, name: this.data.tool.name } });
      this.update({ error: info.message, errorInfo: info }, () => wx.pageScrollTo({ selector: '#tool-error', duration: 200, fail: e => console.error('[LIGHT] error.scroll', { message: e.errMsg }) }));
    } finally { this.update({ busy: false }); if (this.data.result) await this.refreshAvailability(); }
  },
  async loadResultImage() {
    try { this.update({ resultPath: await api.download(this.data.result.artifact), error: '' }); }
    catch (error) { const info = api.reportError(error, { operation: 'tool.preview', jobId: this.data.result.jobId, userMessage: '处理已完成，预览下载失败；重新加载不会重新处理或扣次数。' }); this.update({ error: info.message, errorInfo: info }); }
  },
  async saveResult() {
    if (this.data.saving || !this.data.result) return;
    this.update({ saving: true });
    try {
      const artifact = this.data.result.artifact, filePath = this.data.resultPath || await api.download(artifact);
      if (artifact.mime === 'application/pdf') await actions.openPdf(filePath);
      else { this.update({ resultPath: filePath }); await actions.saveImage(filePath); }
    } catch (error) { if (!isCancel(error)) api.showError(error); }
    finally { this.update({ saving: false }); }
  },
  async previewResult() { if (this.data.resultPath) { try { await actions.previewImage(this.data.resultPath); } catch (error) { api.showError(error); } } },
  startOver() { if (this.data.busy || this.data.saving || this.data.pending) return; this.invalidate(); this.update({ files: [], outputFormat: '' }); this.syncConsent(); wx.pageScrollTo({ scrollTop: 0, duration: 200 }); },
  onShareAppMessage() { return { title: this.data.tool.name + ' · LIGHT 的工具箱', path: '/pages/tool/index?id=' + this.data.tool.id }; }
});
