const config = require('../config');
function init() {
  if (!wx.cloud) throw new Error('当前微信版本不支持云开发，请更新微信');
  wx.cloud.init({ env: config.cloudEnv, traceUser: true });
}
async function call(path, method, data, jobId) {
  const response = await wx.cloud.callFunction({ name: config.cloudFunction, data: { path, method: method || 'GET', data: data || {}, jobId } });
  const result = response.result;
  if (!result || typeof result.ok !== 'boolean') throw new Error('云函数返回格式异常');
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
  return result.data;
}
async function request(path, method, data) {
  if (path === '/api/orders' && method === 'POST') {
    const login = await new Promise((resolve,reject) => wx.login({success:resolve,fail:reject}));
    if (!login.code) throw new Error('微信未返回支付登录 code');
    data = Object.assign({}, data, {code:login.code});
  }
  return call(path, method, data);
}
async function upload(tool, filePaths, fields, jobId) {
  const ticket = await call('/api/uploads','POST',{count:filePaths.length});
  const fileIds=[];
  for (let i=0;i<filePaths.length;i++) {
    const file=await wx.cloud.uploadFile({cloudPath:ticket.paths[i],filePath:filePaths[i]});
    fileIds.push(file.fileID);
  }
  await call('/api/uploads/bind','POST',{ticketId:ticket.ticketId,fileIds});
  return call('/api/tools/'+tool,'POST',{ticketId:ticket.ticketId,fileIds,fields},jobId);
}
async function download(artifact) {
  // Check business ownership/expiry, then use native private cloud storage.
  const result=await call('/api/download','POST',{jobId:artifact.jobId});
  const file=await wx.cloud.downloadFile({fileID:result.fileID});
  if (!file.tempFilePath) throw new Error('云存储未返回下载文件');
  return file.tempFilePath;
}
module.exports={init,request,upload,download,lottery:(entries,title,jobId)=>call('/api/tools/lottery','POST',{entries,title},jobId)};
