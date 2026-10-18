// One explicit confirmation per device and policy version, shared by all four tools.
// Bump VERSION whenever the purposes, recipients or retention terms change.
const KEY = 'light.processingConsent';
const VERSION = '2026-10-12.1';
function storageError(operation, error) {
  console.error('[LIGHT] processingConsent.' + operation, { version: VERSION, message: error.message || error.errMsg });
  const failure = new Error('无法' + ({ read: '读取', accept: '保存', revoke: '撤回' })[operation] + '文件处理确认，请检查设备存储后重试。');
  failure.code = 'CONSENT_STORAGE_' + operation.toUpperCase();
  return failure;
}
function read() {
  try {
    const record = wx.getStorageSync(KEY);
    if (record === '' || record === undefined || record === null) return null;
    if (typeof record !== 'object' || typeof record.version !== 'string' || !Number.isSafeInteger(record.acceptedAt) || record.acceptedAt <= 0) throw new Error('Invalid consent record');
    return record;
  } catch (error) { throw storageError('read', error); }
}
function isAccepted() { const record = read(); return Boolean(record && record.version === VERSION); }
function accept() {
  const record = { version: VERSION, acceptedAt: Date.now() };
  try {
    wx.setStorageSync(KEY, record);
    const saved = read();
    if (!saved || saved.version !== record.version || saved.acceptedAt !== record.acceptedAt) throw new Error('Consent write was not persisted');
    console.info('[LIGHT] processingConsent.accepted', { version: VERSION });
  } catch (error) { throw storageError('accept', error); }
}
function revoke() {
  try {
    wx.removeStorageSync(KEY);
    // Check absence directly so a malformed record can also be explicitly removed.
    const saved = wx.getStorageSync(KEY);
    if (saved !== '' && saved !== undefined && saved !== null) throw new Error('Consent removal was not persisted');
    console.info('[LIGHT] processingConsent.revoked', { version: VERSION });
  } catch (error) { throw storageError('revoke', error); }
}
module.exports = { KEY, VERSION, isAccepted, accept, revoke };
