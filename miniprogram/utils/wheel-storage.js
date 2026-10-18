const KEY = 'light.wheel.v1';
function directory() { return wx.env.USER_DATA_PATH + '/light-wheel'; }
function call(method, options) { return new Promise((resolve, reject) => wx.getFileSystemManager()[method](Object.assign({}, options, { success: resolve, fail: reject }))); }
function load() {
  const value = wx.getStorageSync(KEY);
  if (!value) return null;
  if (value.version !== 1 || !value.draft) throw new Error('本机转盘配置无法识别，请联系支持');
  return value;
}
function save(state) { wx.setStorageSync(KEY, Object.assign({ version: 1 }, state)); }
async function importImage(source, id) {
  const root = directory();
  const roots = await call('readdir', { dirPath: wx.env.USER_DATA_PATH });
  if (!roots.files.includes('light-wheel')) await call('mkdir', { dirPath: root });
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('图片编号无效');
  const path = root + '/' + id + '.img';
  await call('copyFile', { srcPath: source, destPath: path });
  return path;
}
async function cleanup(entries) {
  const root = directory(), roots = await call('readdir', { dirPath: wx.env.USER_DATA_PATH });
  if (!roots.files.includes('light-wheel')) return;
  const retained = new Set(entries.map(e => e.image));
  const files = await call('readdir', { dirPath: root });
  for (const name of files.files) {
    if (!/^[a-zA-Z0-9-]+\.img$/.test(name)) throw new Error('转盘图片目录存在未知文件，停止清理');
    if (!retained.has(root + '/' + name)) await call('unlink', { filePath: root + '/' + name });
  }
}
module.exports = { load, save, importImage, cleanup };
