const wxCloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');
wxCloud.init({env:wxCloud.DYNAMIC_CURRENT_ENV});
const app = tcb.init({env:tcb.SYMBOL_CURRENT_ENV,throwOnCode:true});
const cloud = {
  database:()=>app.database(), getWXContext:()=>wxCloud.getWXContext(),
  getUploadMetadata:options=>app.getUploadMetadata(options),
  getTempFileURL:options=>wxCloud.getTempFileURL(options),
  uploadFile:options=>wxCloud.uploadFile(options), deleteFile:options=>wxCloud.deleteFile(options)
};
let handler;
exports.main = async function(event) {
  if (!handler) handler = (await import('./lib/handler.js')).createHandler(cloud);
  return handler(event);
};
