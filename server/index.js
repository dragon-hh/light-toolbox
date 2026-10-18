import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { log } from './errors.js';

const config=loadConfig(); mkdirSync(config.dataDir,{recursive:true});
const lockPath=path.join(config.dataDir,'server.lock');
// Single writer process: startup recovery must never reset a second running server's jobs.
try {writeFileSync(lockPath,String(process.pid),{flag:'wx'});}
catch(error) {
  if(error.code!=='EEXIST')throw error;
  const pid=Number(readFileSync(lockPath,'utf8')); let alive=true;
  if(!Number.isInteger(pid) || pid<=0)throw new Error('Invalid server.lock; inspect before removing it');
  try {process.kill(pid,0);}catch(probe){if(probe.code==='ESRCH')alive=false;else throw probe;}
  if(alive)throw new Error(`Data directory is already owned by process ${pid}`);
  unlinkSync(lockPath); writeFileSync(lockPath,String(process.pid),{flag:'wx'});
}
process.once('exit',()=>unlinkSync(lockPath));
const {app,store,payments,cleanup}=createApp(config);
const recovered=store.recoverJobs(); if(recovered)log('jobs.recovered',{count:recovered},'warn');
cleanup();
const server=app.listen(config.port,config.mode==='local' ? '127.0.0.1':'0.0.0.0',()=>log('server.ready',{mode:config.mode,port:config.port}));
server.on('error',error=>{throw error;});
const cleanupTimer=setInterval(()=>{try{cleanup();}catch(error){log('cleanup.failed',{stack:error.stack},'error');}},60000);
const paymentTimer=config.mode==='production' ? setInterval(()=>payments.reconcile().catch(error=>log('reconcile.failed',{stack:error.stack},'error')),300000):null;
if(config.mode==='production')payments.reconcile().catch(error=>log('reconcile.failed',{stack:error.stack},'error'));
function shutdown(){clearInterval(cleanupTimer);if(paymentTimer)clearInterval(paymentTimer);server.close(()=>{store.close();process.exit(0);});}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
