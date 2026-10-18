// Only this app session: temporary paths and forms survive a tab switch, not a restart.
// No image bytes or form content are written to persistent storage or logs.
const drafts = Object.create(null);
let returnTarget = null;
const copy = value => value ? JSON.parse(JSON.stringify(value)) : null;
function save(id, value) { drafts[id] = copy(value); }
function load(id) { return copy(drafts[id]); }
function openMember(target) {
  returnTarget = copy(target);
  wx.switchTab({ url: '/pages/member/index', fail: error => require('./api').showError(error) });
}
module.exports = { save, load, openMember, getReturn: () => copy(returnTarget), clearReturn: () => { returnTarget = null; } };
