const pad = value => String(value).padStart(2, '0');
function dateTime(value) {
  const date = new Date(value);
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}
function fileSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB'; }
function entitlement(profile) { return profile.local ? '测试体验 · 暂不收费' : profile.isMember ? '月卡生效中 · 本次无需另付费' : '剩余 ' + profile.credits + ' 次 · 本次消耗 1 次，失败不扣'; }
function expiresAt(job) { return job.result && job.result.artifact ? job.result.artifact.expiresAt : job.finished_at + 3600000; }
function expiryLabel(expiry, now, tool) { return expiry <= now ? '结果已过期' : (tool === 'lottery' ? '还可查看约 ' : '还可保存约 ') + Math.ceil((expiry - now) / 60000) + ' 分钟'; }
const errors = {
  INVALID_IMAGE: '无法读取这张图片，请换一张 JPG、PNG 或 WebP 图片。', IMAGE_FORMAT: '请使用静态 JPG、PNG 或 WebP 图片。',
  INVALID_PDF: 'PDF 已加密、损坏或格式不正确，请解除密码或更换文件。', PDF_TOO_LONG: '合并后超过 500 页，请减少文件。',
  NO_PORTRAIT: '没有识别到人像，请使用清晰的正面半身照片。', PHOTO_TOO_LARGE: '照片过大，请先压缩后再制作。',
  PORTRAIT_PROVIDER: '人像处理服务暂时失败，请稍后重试。'
};
function failureText(code) { return errors[code] || '处理未完成，请重试；如果仍然失败，可复制排查信息联系客服。'; }
module.exports = { dateTime, fileSize, entitlement, expiresAt, expiryLabel, failureText };
