const config = require('../config');
const cloud = config.transport === 'cloud' ? require('./cloud-api') : null;
let loginPromise = null;
function responseError(res, message) {
  const detail = res.data && res.data.error;
  if (res.statusCode === 401) wx.removeStorageSync('light.token');
  return Object.assign(new Error(detail ? detail.message : message), detail || {});
}
function request(path, method, data, anonymous) {
  if (cloud) return cloud.request(path,method,data);
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.apiBase + path, method: method || 'GET', data,
      timeout: 60000,
      header: { Authorization: anonymous ? '' : 'Bearer ' + (wx.getStorageSync('light.token') || '') },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data);
        reject(responseError(res, '服务返回异常'));
      },
      fail(res) { reject(new Error('网络连接失败，请检查网络后重试。' + res.errMsg)); }
    });
  });
}
function uuid() {
  // Request IDs are not security tokens. Security tokens are generated only on the server.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
function login(force) {
  if (cloud) return Promise.resolve();
  if (!force && wx.getStorageSync('light.token')) return Promise.resolve();
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    let result;
    if (config.mode === 'local') {
      const info = wx.getDeviceInfo();
      if (info.platform !== 'devtools') throw new Error('真机需要配置 HTTPS 服务端，不能使用电脑本地体验模式');
      let deviceId = wx.getStorageSync('light.device');
      if (!deviceId) { deviceId = uuid(); wx.setStorageSync('light.device', deviceId); }
      result = await request('/api/auth/local', 'POST', { deviceId }, true);
    } else {
      const code = await new Promise((resolve, reject) => wx.login({ success: r => r.code ? resolve(r.code) : reject(new Error('微信未返回登录 code')), fail: reject }));
      result = await request('/api/auth/login', 'POST', { code }, true);
    }
    wx.setStorageSync('light.token', result.token);
  })();
  return loginPromise.finally(() => { loginPromise = null; });
}
async function authed(path, method, data) { await login(); return request(path, method, data); }
async function upload(tool, filePaths, fields, jobId) {
  if (cloud) return cloud.upload(tool,filePaths,fields,jobId);
  await login();
  // wx.uploadFile supports a single file; for PDF groups build one binary multipart body.
  const boundary = 'LIGHT' + uuid().replace(/-/g, '');
  const fs = wx.getFileSystemManager(), parts = [];
  function ascii(text) { const arr = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) arr[i] = text.charCodeAt(i); return arr; }
  Object.keys(fields).forEach(key => parts.push(ascii('--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' + fields[key] + '\r\n')));
  for (let i = 0; i < filePaths.length; i++) {
    const buffer = await new Promise((resolve, reject) => fs.readFile({ filePath: filePaths[i], success: r => resolve(r.data), fail: reject }));
    parts.push(ascii('--' + boundary + '\r\nContent-Disposition: form-data; name="files"; filename="file' + i + '"\r\nContent-Type: application/octet-stream\r\n\r\n'));
    parts.push(new Uint8Array(buffer)); parts.push(ascii('\r\n'));
  }
  parts.push(ascii('--' + boundary + '--\r\n'));
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0)); let offset = 0;
  parts.forEach(part => { bytes.set(part, offset); offset += part.length; });
  return new Promise((resolve, reject) => wx.request({
    url: config.apiBase + '/api/tools/' + tool, method: 'POST', data: bytes.buffer, timeout: 60000,
    header: { Authorization: 'Bearer ' + wx.getStorageSync('light.token'), 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Idempotency-Key': jobId },
    success(res) {
      if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data);
      reject(responseError(res, '处理失败'));
    }, fail(res) { reject(new Error('请求中断，请先到使用记录查看结果，避免重复提交。' + res.errMsg)); }
  }));
}
async function lottery(entries, title, jobId) {
  if (cloud) return cloud.lottery(entries,title,jobId);
  await login();
  return new Promise((resolve, reject) => wx.request({
    url: config.apiBase + '/api/tools/lottery', method: 'POST', data: { entries, title }, timeout: 60000,
    header: { Authorization: 'Bearer ' + wx.getStorageSync('light.token'), 'Idempotency-Key': jobId },
    success(res) { if (res.statusCode === 200) resolve(res.data); else reject(responseError(res, '抽取失败')); },
    fail(res) { reject(new Error('网络中断，请先到记录页查看抽取结果。' + res.errMsg)); }
  }));
}
async function download(artifact) {
  if (cloud) return cloud.download(artifact);
  await login();
  return new Promise((resolve, reject) => wx.downloadFile({
    url: config.apiBase + artifact.url, header: { Authorization: 'Bearer ' + wx.getStorageSync('light.token') },
    success(res) { if (res.statusCode === 200) resolve(res.tempFilePath); else reject(responseError(res, res.statusCode === 410 ? '文件已过期，请重新处理' : '文件下载失败，请重试')); }, fail: reject
  }));
}
function reportError(error, options) {
  const context = options || {};
  const message = error.message || error.errMsg || '发生未知错误';
  const privacyUndeclared = /api scope is not declared in the privacy agreement/i.test(message);
  console.error('[LIGHT] request.error', { code: privacyUndeclared ? 'PRIVACY_DECLARATION_MISSING' : error.code, requestId: error.requestId, operation: context.operation, jobId: context.jobId, orderId: context.orderId, platformErrno: error.errno, message });
  if (privacyUndeclared) {
    // This is an operator-side declaration issue. Phone settings cannot fix it.
    // Keep the raw platform failure in logs; never bypass privacy enforcement.
    if (/^setClipboardData:fail\b/i.test(message)) {
      return errorInfo('暂时无法复制', '本次复制未成功。小程序尚未完成剪贴板使用声明，请稍后再试。');
    }
    return errorInfo('功能暂不可用', '小程序的隐私声明尚未配置完成，此功能暂时无法使用。请稍后重试或联系客服。');
  }
  if (error.code === 'PAYMENT_REQUIRED') {
    return Object.assign(errorInfo('需要使用次数', '可用次数不足，请购买次数或开通月卡。'), { requiresPayment: true, returnTo: context.returnTo || null });
  }
  return errorInfo('这一步没有完成', context.userMessage || message);
  function errorInfo(title, displayMessage) {
    const diagnostic = [
      ['错误代码', privacyUndeclared ? 'PRIVACY_DECLARATION_MISSING' : error.code], ['请求编号', error.requestId],
      ['任务编号', context.jobId || error.jobId], ['订单编号', context.orderId || error.orderId],
      ['平台错误码', error.errno], ['操作', context.operation]
    ].filter(pair => pair[1] !== undefined && pair[1] !== null && pair[1] !== '').map(pair => pair[0] + '：' + pair[1]).join('\n');
    return { title, message: displayMessage, diagnostic };
  }
}
function showError(error, options) {
  const info = reportError(error, options);
  if (info.requiresPayment) {
    wx.showModal({ title: info.title, content: info.message, confirmText: '查看套餐', success: r => { if (r.confirm) require('./tool-session').openMember(info.returnTo); } });
    return;
  }
  wx.showModal({ title: info.title, content: info.message, showCancel: Boolean(info.diagnostic), cancelText: '关闭', confirmText: info.diagnostic ? '查看详情' : '确定', success: r => {
    if (r.confirm && info.diagnostic) wx.showModal({ title: '排查详情', content: info.diagnostic, showCancel: false });
  } });
}
module.exports = { config, request, authed, login, upload, lottery, download, uuid, showError, reportError };
