const api = require('./api');
async function saveImage(filePath) {
  try {
    await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject }));
    wx.showToast({ title: '已保存到相册' });
  } catch (error) {
    const message = error.message || error.errMsg || '';
    if (!/privacy agreement/i.test(message) && /auth deny|auth denied|authorize|permission/i.test(message)) {
      console.error('[LIGHT] album.permission', { errno: error.errno, message });
      wx.showModal({ title: '需要相册权限', content: '请允许保存到相册，然后再次点击保存。', confirmText: '打开设置', success: r => { if (r.confirm) wx.openSetting({ fail: api.showError }); } });
    } else throw error;
  }
}
function openPdf(filePath) { return new Promise((resolve, reject) => wx.openDocument({ filePath, fileType: 'pdf', showMenu: true, success: resolve, fail: reject })); }
function previewImage(filePath) { return new Promise((resolve, reject) => wx.previewImage({ urls: [filePath], current: filePath, success: resolve, fail: reject })); }
module.exports = { saveImage, openPdf, previewImage };
