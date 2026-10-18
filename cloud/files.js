import { randomBytes, randomUUID } from 'node:crypto';
import { requireValue, log } from '../server/errors.js';
import { hash } from './store.js';
import { TTL } from './config.js';

const MAX=10*1024*1024;
export class CloudFiles {
  constructor(cloud,store,envId,fetcher=fetch) {this.cloud=cloud;this.store=store;this.envId=envId;this.fetcher=fetcher;}
  async ticket(userId,count) {
    requireValue(Number.isInteger(count) && count>=1 && count<=10,'FILE_COUNT','文件数量无效');
    const id=randomBytes(24).toString('hex');
    const paths=Array.from({length:count},(_,i)=>`light-toolbox/input/${hash(userId)}/${id}/${i}`);
    const fileIds=[];
    for(const cloudPath of paths) {
      const metadata=await this.cloud.getUploadMetadata({cloudPath});
      requireValue(metadata.data?.fileId && !metadata.code,'STORAGE_METADATA','上传地址生成失败',502);
      fileIds.push(metadata.data.fileId);
    }
    // Save IDs before any client upload, so lost responses and abandoned batches
    // remain enumerable by the expiry worker. Upload credentials stay server-side.
    await this.store.put('uploads',id,{id,user_id:userId,paths,file_ids:fileIds,created_at:this.store.now(),expires_at:this.store.now()+TTL,status:'uploading'});
    return {ticketId:id,paths};
  }
  validate(fileIds,ticket) {
    requireValue(Array.isArray(fileIds) && fileIds.length===ticket.paths.length,'FILE_COUNT','上传文件数量不一致');
    fileIds.forEach((id,i)=>{
      requireValue(typeof id==='string' && id.startsWith('cloud://'+this.envId+'.') && id.slice(id.indexOf('/',8)+1)===ticket.paths[i],'FILE_OWNER','文件不属于本次上传',403);
      requireValue(id===ticket.file_ids[i],'FILE_OWNER','上传文件编号不一致',403);
    });
  }
  async bind(userId,ticketId,fileIds) {
    const ticket=await this.store.get('uploads',ticketId);
    requireValue(ticket && ticket.user_id===userId && ticket.expires_at>this.store.now(),'UPLOAD_EXPIRED','上传会话不存在或已过期',410);
    this.validate(fileIds,ticket);
    await this.store.put('uploads',ticketId,{...ticket,file_ids:fileIds,status:'ready'});
    return ticket;
  }
  async read(fileId) {
    const res=await this.cloud.getTempFileURL({fileList:[{fileID:fileId,maxAge:60}]});
    const file=res.fileList[0];
    requireValue(file && file.status===0 && file.tempFileURL,'FILE_READ','无法读取上传的文件',502);
    const response=await this.fetcher(file.tempFileURL,{signal:AbortSignal.timeout(30000)});
    requireValue(response.ok && Number(response.headers.get('content-length') || 0)<=MAX,'FILE_SIZE','单个文件不能超过 10MB');
    const chunks=[];let size=0;
    for await(const chunk of response.body) {size+=chunk.length;requireValue(size<=MAX,'FILE_SIZE','单个文件不能超过 10MB');chunks.push(chunk);}
    return Buffer.concat(chunks);
  }
  async output(userId,jobId,tool,output) {
    const id=randomUUID(),filename=`LIGHT-${tool}-${jobId.slice(0,8)}.${output.extension}`,expiresAt=this.store.now()+TTL;
    const cloudPath=`light-toolbox/results/${hash(userId)}/${id}/${filename}`;
    const metadata=await this.cloud.getUploadMetadata({cloudPath});
    requireValue(metadata.data?.fileId && !metadata.code,'STORAGE_METADATA','结果地址生成失败',502);
    await this.store.put('uploads','result-'+id,{id:'result-'+id,user_id:userId,paths:[cloudPath],file_ids:[metadata.data.fileId],created_at:this.store.now(),expires_at:expiresAt,status:'result'});
    const stored=await this.cloud.uploadFile({cloudPath,fileContent:output.buffer});
    requireValue(stored.fileID===metadata.data.fileId,'STORAGE_METADATA','结果存储编号不一致',502);
    return {id,jobId,filename,mime:output.mime,expiresAt,fileID:stored.fileID};
  }
  async remove(fileIds) {
    if(!fileIds.length)return;
    const result=await this.cloud.deleteFile({fileList:fileIds});
    // wx-server-sdk maps STORAGE_FILE_NONEXIST to -503003. A registered
    // upload may never have happened, and a prior delete may have lost its
    // response. Both have already reached the intended absent state.
    const rows=result.fileList;
    requireValue(Array.isArray(rows) && rows.length===fileIds.length,'FILE_CLEANUP','文件删除响应不完整',500);
    const failures=rows.filter(file=>file.status!==0 && file.status!==-503003);
    if(failures.length)log('cloud.files.delete_failed',{count:failures.length,statuses:failures.map(file=>file.status),providerRequestId:result.requestId},'error');
    requireValue(!failures.length,'FILE_CLEANUP','文件删除未全部成功',500);
    log('cloud.files.removed',{count:rows.length,alreadyMissing:rows.filter(file=>file.status===-503003).length});
  }
  async cleanupTicket(ticketId) {
    const ticket=await this.store.get('uploads',ticketId);
    if(!ticket)return;
    await this.remove(ticket.file_ids);
    await this.store.ref('uploads',ticketId).remove();
  }
  async download(userId,jobId) {
    const job=await this.store.get('jobs',jobId),artifact=job && job.result && job.result.artifact;
    requireValue(job && job.user_id===userId && job.status==='succeeded' && artifact,'FILE_NOT_FOUND','结果文件不存在',404);
    requireValue(artifact.expiresAt>this.store.now(),'FILE_EXPIRED','结果文件已过期',410);
    // The verified PRIVATE ACL binds server-generated files to the calling
    // mini-program user. Native download applies that same identity boundary.
    return {fileID:artifact.fileID};
  }
  async cleanup() {
    const db=this.store.db,_=db.command,now=this.store.now();
    const uploads=(await db.collection('light_uploads').where({expires_at:_.lte(now)}).limit(100).get()).data;
    for(const ticket of uploads)await this.cleanupTicket(ticket.id);
    const jobs=(await db.collection('light_jobs').where({status:'succeeded',finished_at:_.lte(now-TTL),result:_.neq(null)}).limit(100).get()).data;
    for(const job of jobs) {
      await this.store.ref('jobs',job.id).update({result:null});
    }
    const interrupted=(await db.collection('light_jobs').where({status:'processing',created_at:_.lt(now-15*60000)}).limit(100).get()).data;
    for(const job of interrupted)await this.store.finish(job.id,null,'PROCESS_INTERRUPTED');
    log('cloud.cleanup',{uploads:uploads.length,results:jobs.length,interrupted:interrupted.length});
    return {uploads:uploads.length,results:jobs.length,interrupted:interrupted.length};
  }
}
