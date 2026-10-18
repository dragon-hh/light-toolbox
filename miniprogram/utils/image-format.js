// Read only container metadata on the device. Do not upload a file to determine
// the compression format, or guess transparency from its extension.
// Specs: https://www.w3.org/TR/png-3/ and
// https://developers.google.com/speed/webp/docs/riff_container
function inspect(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => { throw Object.assign(new Error('无法识别图片格式，请重新选择静态 JPG、PNG 或 WebP 图片。'), { code: 'IMAGE_FORMAT' }); };
  const animated = () => { throw Object.assign(new Error('暂不支持动态图，请选择静态图片。'), { code: 'IMAGE_FORMAT' }); };
  const text = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
  const format = alpha => alpha ? 'WebP · 保留透明通道' : 'JPG';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return format(false);
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) {
    if (text(12) !== 'IHDR' || view.getUint32(8) !== 13) return invalid();
    const color = bytes[25];
    if (![0,2,3,4,6].includes(color)) return invalid();
    let alpha = color === 4 || color === 6, image = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset), kind = text(offset + 4), next = offset + size + 12;
      if (next > bytes.length) return invalid();
      if (kind === 'acTL') return animated();
      if (kind === 'tRNS') alpha = true;
      if (kind === 'IDAT') image = true;
      if (kind === 'IEND') return image ? format(alpha) : invalid();
      offset = next;
    }
    return invalid();
  }
  if (bytes.length >= 20 && text(0) === 'RIFF' && text(8) === 'WEBP') {
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length || end < 20) return invalid();
    let alpha = false, image = false;
    for (let offset = 12; offset + 8 <= end;) {
      const kind = text(offset), size = view.getUint32(offset + 4, true), start = offset + 8, next = start + size + (size % 2);
      if (next > end) return invalid();
      if (kind === 'VP8X') {
        if (size !== 10) return invalid();
        if (bytes[start] & 2) return animated();
        alpha = Boolean(bytes[start] & 16);
      }
      if (kind === 'ANIM' || kind === 'ANMF') return animated();
      if (kind === 'ALPH') alpha = true;
      if (kind === 'VP8L') {
        if (size < 5 || bytes[start] !== 47) return invalid();
        alpha = alpha || Boolean(bytes[start + 4] & 16); image = true;
      }
      if (kind === 'VP8 ') { if (!size) return invalid(); image = true; }
      offset = next;
    }
    return image ? format(alpha) : invalid();
  }
  return invalid();
}
async function forFile(filePath) {
  const result = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath, success: resolve, fail: reject }));
  return inspect(result.data);
}
module.exports = { inspect, forFile };
