const { COLORS } = require('./wheel');
function loadImage(canvas, src) {
  return new Promise((resolve, reject) => { const image = canvas.createImage(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('转盘图片读取失败，请重新选择对应图片')); image.src = src; });
}
async function render(page, entries) {
  const canvas = await new Promise((resolve, reject) => page.createSelectorQuery().select('#wheel-canvas').fields({ node: true, size: true }).exec(result => {
    if (!result[0] || !result[0].node) reject(new Error('转盘画布未就绪')); else resolve(result[0].node);
  }));
  canvas.width = 900; canvas.height = 900;
  const ctx = canvas.getContext('2d'), center = 450, radius = 446, step = Math.PI * 2 / entries.length;
  const images = await Promise.all(entries.map(e => loadImage(canvas, e.image)));
  ctx.clearRect(0, 0, 900, 900);
  entries.forEach((entry, i) => {
    const angle = i * step - Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(center, center); ctx.arc(center, center, radius, angle - step / 2, angle + step / 2); ctx.closePath();
    ctx.fillStyle = COLORS[i]; ctx.fill(); ctx.strokeStyle = '#183F35'; ctx.lineWidth = 3; ctx.stroke();
    ctx.save(); ctx.translate(center, center); ctx.rotate(i * step);
    const side = entries.length > 6 ? 116 : 140, y = -radius * 0.73, image = images[i];
    ctx.save(); ctx.beginPath(); ctx.arc(0, y, side / 2, 0, Math.PI * 2); ctx.clip();
    const sourceSize = Math.min(image.width, image.height);
    ctx.drawImage(image, (image.width - sourceSize) / 2, (image.height - sourceSize) / 2, sourceSize, sourceSize, -side / 2, y - side / 2, side, side); ctx.restore();
    ctx.fillStyle = '#183F35'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 29px sans-serif';
    const chars = Array.from(entry.label.trim()), lines = [chars.slice(0, 4).join(''), chars.slice(4, 8).join('') + (chars.length > 8 ? '…' : '')];
    lines.forEach((line, n) => { if (line) ctx.fillText(line, 0, y + side / 2 + 30 + n * 34); });
    ctx.restore();
  });
  return new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, width: 900, height: 900, destWidth: 900, destHeight: 900, fileType: 'png', success: r => resolve(r.tempFilePath), fail: reject }, page));
}
module.exports = { render };
