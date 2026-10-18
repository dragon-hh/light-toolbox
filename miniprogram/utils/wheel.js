const COLORS = ['#FFF1C9', '#F5BF49', '#F2DCD0', '#D4E8D4', '#F4D596', '#E9EEE0', '#F6CCB7', '#DBE6EC'];
function defaults() {
  const examples = [['coffee', '一杯咖啡'], ['gift', '神秘小礼物'], ['clapperboard', '看场电影'], ['ice-cream-bowl', '吃个冰淇淋'], ['headphones', '听一首喜欢的歌'], ['sun', '出门晒晒太阳']];
  return { title: '今日份小确幸', weighted: false, entries: examples.map((e, i) => ({ id: 'example-' + i, label: e[1], image: '/assets/wheel/' + e[0] + '.png', weight: 1 })) };
}
function validate(draft) {
  if (!draft || typeof draft.title !== 'string' || !draft.title.trim() || draft.title.trim().length > 24) throw new Error('请填写 1–24 字的转盘名称');
  if (!Array.isArray(draft.entries) || draft.entries.length < 2 || draft.entries.length > 8) throw new Error('请配置 2–8 个选项');
  if (new Set(draft.entries.map(e => e.id)).size !== draft.entries.length) throw new Error('选项编号重复');
  draft.entries.forEach((e, i) => {
    if (!e || typeof e.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(e.id)) throw new Error('选项编号无效');
    if (typeof e.label !== 'string' || !e.label.trim() || e.label.trim().length > 40) throw new Error('请填写第 ' + (i + 1) + ' 项的文字描述（1–40 字）');
    if (typeof e.image !== 'string' || !e.image) throw new Error('请为第 ' + (i + 1) + ' 项选择图片');
    if (draft.weighted && (!Number.isInteger(Number(e.weight)) || Number(e.weight) < 1 || Number(e.weight) > 100)) throw new Error('第 ' + (i + 1) + ' 项权重须为 1–100 的整数');
  });
}
function payload(draft) {
  validate(draft);
  return { title: draft.title.trim(), entries: draft.entries.map(e => ({ id: e.id, label: e.label.trim(), weight: draft.weighted ? Number(e.weight) : 1 })) };
}
function decorate(entries, weighted) {
  const valid = entries.every(e => Number.isInteger(Number(e.weight)) && Number(e.weight) >= 1 && Number(e.weight) <= 100);
  const total = weighted && valid ? entries.reduce((n, e) => n + Number(e.weight), 0) : entries.length;
  return entries.map((e, i) => Object.assign({}, e, { color: COLORS[i], chance: weighted && !valid ? '—' : ((weighted ? Number(e.weight) : 1) / total * 100).toFixed(1) + '%' }));
}
function landingAngle(current, index, count) {
  if (!Number.isFinite(current) || !Number.isInteger(index) || index < 0 || index >= count || count < 2 || count > 8) throw new Error('转盘落点参数无效');
  const target = (360 - index * 360 / count) % 360;
  return current + 360 * 6 + (target - current % 360 + 360) % 360;
}
function validateResult(result, entries, jobId) {
  if (!result || result.version !== 2 || result.jobId !== jobId || !Number.isInteger(result.winnerIndex) || !entries[result.winnerIndex] || result.entryCount !== entries.length || !result.winner || result.winner.id !== entries[result.winnerIndex].id || result.winner.label !== entries[result.winnerIndex].label.trim()) throw new Error('抽奖结果与当前转盘不一致，请到记录页核对本次任务');
}
const wheelCore = { COLORS, defaults, validate, payload, decorate, landingAngle, validateResult };
if (typeof module !== 'undefined') module.exports = wheelCore;
else globalThis.LightWheel = wheelCore;
