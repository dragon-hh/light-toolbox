const api = require('../../utils/api');
const catalog = require('../../utils/catalog');
const { dateTime, expiresAt, expiryLabel, failureText } = require('../../utils/presentation');
const actions = require('../../utils/file-actions');
Page({
  data: { jobs: [], loading: false, error: '', busyId: '', detailId: '', errorInfo: null },
  onShow() { if (this.getTabBar()) this.getTabBar().setData({ selected: 1 }); this.load(); },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    const sequence = (this.sequence || 0) + 1; this.sequence = sequence;
    this.setData({ loading: true });
    try {
      const jobs = await api.authed('/api/jobs'); if (sequence !== this.sequence) return;
      const now = Date.now();
      this.setData({ jobs: jobs.map(job => {
        const tool = catalog.find(t => t.id === job.tool); if (!tool) throw new Error('记录中的工具类型无法识别，请联系客服');
        const expiry = expiresAt(job), expired = !job.result || expiry <= now;
        return Object.assign({}, job, { name: tool.name, icon: tool.icon, tone: tool.tone, date: dateTime(job.created_at), expiry, expired,
          expiryText: expiryLabel(expiry, now, job.tool), failureText: failureText(job.error), stateLabel: job.status === 'processing' ? '处理中' : job.status === 'failed' ? '处理失败' : expired ? '结果已过期' : '已完成' });
      }), error: '' });
    } catch (error) { if (sequence === this.sequence) { const info = api.reportError(error, { operation: 'records.load' }); this.setData({ error: info.message, errorInfo: info }); } }
    finally { if (sequence === this.sequence) this.setData({ loading: false }); }
  },
  job(event) {
    const job = this.data.jobs.find(j => j.id === event.currentTarget.dataset.id);
    if (!job) throw new Error('未找到这条记录，请刷新');
    if (job.status !== 'succeeded' || !job.result || expiresAt(job) <= Date.now()) throw new Error('结果已不可用，请刷新记录；已过期的文件需要重新处理');
    return job;
  },
  async useResult(event) {
    if (this.data.busyId) return;
    try {
      const job = this.job(event), save = event.currentTarget.dataset.action === 'save';
      this.setData({ busyId: job.id });
      if (job.tool === 'lottery') {
        if (!Array.isArray(job.result.winners)) throw new Error('抽奖结果格式异常，请复制排查信息联系客服');
        return wx.showModal({ title: job.result.title || '抽取结果', content: job.result.winners.join('、'), confirmText: '关闭', showCancel: false });
      }
      const filePath = await api.download(job.result.artifact);
      if (job.tool === 'pdf') await actions.openPdf(filePath);
      else if (save) await actions.saveImage(filePath);
      else await actions.previewImage(filePath);
    } catch (error) { api.showError(error); }
    finally { this.setData({ busyId: '' }); }
  },
  toggleDetails(event) { const id = event.currentTarget.dataset.id; this.setData({ detailId: this.data.detailId === id ? '' : id }); },
  copyDiagnostic(event) {
    const job = this.data.jobs.find(j => j.id === event.currentTarget.dataset.id);
    if (job) wx.setClipboardData({ data: ['工具：' + job.name, '任务编号：' + job.id, '状态：' + job.status, '错误代码：' + (job.error || '无')].join('\n'), fail: error => api.showError(error, { operation: 'records.copyDiagnostic', jobId: job.id }) });
  },
  openTool(event) { const tool = event.currentTarget.dataset.tool; wx.navigateTo({ url: tool === 'lottery' ? '/pages/wheel/index' : '/pages/tool/index?id=' + tool }); },
  goHome() { wx.switchTab({ url: '/pages/home/index' }); }
});
