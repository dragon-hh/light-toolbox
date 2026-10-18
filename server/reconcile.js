import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { requireValue } from './errors.js';
const config=loadConfig();
requireValue(config.mode==='production','CONFIG','Reconciliation requires production mode');
const {store,payments}=createApp(config);
try {await payments.reconcile();} finally {store.close();}
