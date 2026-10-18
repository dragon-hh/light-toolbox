import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { randomInt } from 'node:crypto';
import bda from 'tencentcloud-sdk-nodejs-bda';
import { AppError, requireValue, log } from './errors.js';

export const TOOL_NAMES = { photo:'证件照', lottery:'幸运转盘', pdf:'PDF 合并', compress:'图像压缩' };
export const PHOTO_SIZES = { one:[295,413], two:[413,579], small:[260,378] };
export const BACKGROUNDS = { white:'#FFFFFF', blue:'#438EDB', red:'#D94141' };
export function drawLottery(entries, title, random = randomInt) {
  requireValue(Array.isArray(entries) && entries.length>=2 && entries.length<=8,'INVALID_ENTRIES','请配置 2–8 个转盘选项');
  requireValue(typeof title==='string' && title.trim().length>0 && title.trim().length<=24,'INVALID_TITLE','转盘名称应为 1–24 个字符');
  requireValue(entries.every(e=>e && typeof e.id==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(e.id) && typeof e.label==='string' && e.label.trim().length>0 && e.label.trim().length<=40),'INVALID_ENTRIES','每项需要有效编号和 1–40 字的描述');
  requireValue(new Set(entries.map(e=>e.id)).size===entries.length,'DUPLICATE_ENTRIES','选项编号重复，请重新配置');
  requireValue(entries.every(e=>Number.isInteger(e.weight) && e.weight>=1 && e.weight<=100),'INVALID_WEIGHT','权重必须为 1–100 的整数');
  // Integer tickets and crypto.randomInt avoid float boundaries and modulo bias.
  const total=entries.reduce((n,e)=>n+e.weight,0),ticket=random(0,total);
  let boundary=0;
  const winnerIndex=entries.findIndex(e=>{boundary+=e.weight;return ticket<boundary;});
  requireValue(winnerIndex>=0,'RANDOM_RESULT','随机数结果无效',500);
  const entry=entries[winnerIndex],winner={id:entry.id,label:entry.label.trim()};
  return {version:2,title:title.trim(),winner,winnerIndex,entryCount:entries.length,probability:entry.weight/total,winners:[winner.label]};
}
async function imageMetadata(buffer) {
  let metadata;
  try { metadata=await sharp(buffer,{limitInputPixels:40000000}).metadata(); }
  catch { throw new AppError('INVALID_IMAGE','无法读取图片，请选择 JPG、PNG 或 WebP 文件'); }
  requireValue(['jpeg','png','webp'].includes(metadata.format) && (metadata.pages || 1)===1,'IMAGE_FORMAT','仅支持静态 JPG、PNG、WebP 图片');
  return metadata;
}
export async function compressImage(buffer, quality) {
  requireValue(Number.isInteger(quality) && quality>=20 && quality<=95,'INVALID_QUALITY','压缩质量应为 20–95');
  const metadata=await imageMetadata(buffer);
  const pipeline=sharp(buffer,{limitInputPixels:40000000}).rotate();
  // Preserve transparency by encoding alpha images as WebP; opaque photos use JPEG.
  const encoded=metadata.hasAlpha ? await pipeline.webp({quality,effort:4}).toBuffer() : await pipeline.jpeg({quality,mozjpeg:true}).toBuffer();
  const isSmaller=encoded.length<buffer.length;
  const extension=isSmaller ? (metadata.hasAlpha ? 'webp':'jpg') : (metadata.format==='jpeg' ? 'jpg':metadata.format);
  return { buffer:isSmaller ? encoded:buffer, extension, mime:extension==='jpg' ? 'image/jpeg':'image/'+extension,
    details:{ originalBytes:buffer.length,outputBytes:Math.min(buffer.length,encoded.length),savedPercent:Math.max(0,Math.round((1-encoded.length/buffer.length)*100)),unchanged:!isSmaller,
      note:isSmaller ? '压缩完成' : '原图已经足够小，本次保留原文件；可能包含原有拍摄信息。' } };
}
export async function mergePdfs(buffers) {
  requireValue(buffers.length>=2 && buffers.length<=10,'PDF_COUNT','请选择 2–10 个 PDF');
  const output=await PDFDocument.create(); let totalPages=0;
  for(let index=0;index<buffers.length;index++) {
    requireValue(buffers[index].subarray(0,1024).includes(Buffer.from('%PDF-')),'INVALID_PDF',`第 ${index+1} 个文件不是有效 PDF`);
    let source;
    try { source=await PDFDocument.load(buffers[index]); }
    catch { throw new AppError('INVALID_PDF',`第 ${index+1} 个 PDF 已加密或损坏，请先解除密码或更换文件`); }
    totalPages+=source.getPageCount();
    requireValue(totalPages<=500,'PDF_TOO_LONG','合并后的 PDF 不能超过 500 页');
    const pages=await output.copyPages(source,source.getPageIndices()); pages.forEach(p=>output.addPage(p));
  }
  requireValue(totalPages>0,'EMPTY_PDF','PDF 中没有可合并的页面');
  output.setProducer('LIGHT Toolbox');
  return {buffer:Buffer.from(await output.save()),extension:'pdf',mime:'application/pdf',details:{pages:totalPages,files:buffers.length}};
}
export function portraitProvider(config) {
  if(!config.tencentId || !config.tencentKey) return null;
  const client=new bda.bda.v20200324.Client({credential:{secretId:config.tencentId,secretKey:config.tencentKey},region:config.region,profile:{httpProfile:{reqTimeout:30}}});
  return async (buffer,requestId)=>{
    let result;
    try { result=await client.SegmentPortraitPic({Image:buffer.toString('base64'),RspImgType:'base64',Scene:'GEN'}); }
    catch(error) { log('portrait.provider_failed',{requestId,providerCode:error.code || 'UNKNOWN',providerRequestId:error.requestId},'error'); throw new AppError('PORTRAIT_PROVIDER','人像分割服务失败，本次不扣次数。请稍后重试',502); }
    log('portrait.provider_completed',{requestId,providerRequestId:result.RequestId});
    requireValue(result.HasForeground===true && result.ResultImage,'NO_PORTRAIT','没有识别到人像，请使用清晰的正面半身照片');
    return Buffer.from(result.ResultImage,'base64');
  };
}
export async function makeIdPhoto(buffer, size, background, segment, requestId) {
  requireValue(segment,'PHOTO_NOT_CONFIGURED','证件照服务尚未开通，请稍后再来',503);
  requireValue(PHOTO_SIZES[size] && BACKGROUNDS[background],'PHOTO_OPTIONS','请选择有效的尺寸和背景');
  await imageMetadata(buffer);
  const normalized=await sharp(buffer,{limitInputPixels:40000000}).rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
  requireValue(normalized.length*4/3<5*1024*1024,'PHOTO_TOO_LARGE','图片过大，请先压缩');
  const foreground=await segment(normalized,requestId);
  const [width,height]=PHOTO_SIZES[size];
  const result=await sharp(foreground,{limitInputPixels:40000000}).resize(width,height,{fit:'cover',position:'centre'}).flatten({background:BACKGROUNDS[background]}).withMetadata({density:300}).jpeg({quality:95}).toBuffer();
  return {buffer:result,extension:'jpg',mime:'image/jpeg',details:{width,height,dpi:300,size,background}};
}
