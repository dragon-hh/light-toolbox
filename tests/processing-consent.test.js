import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync('miniprogram/utils/processing-consent.js','utf8');
function device() {
  const values=new Map(),logs=[];
  const wx={getStorageSync:key=>values.has(key)?structuredClone(values.get(key)):'',setStorageSync:(key,value)=>values.set(key,structuredClone(value)),removeStorageSync:key=>values.delete(key)};
  function reload(){const c={module:{exports:{}},wx,console:{info:()=>{},error:(...args)=>logs.push(args)}};vm.runInNewContext(source,c);return c.module.exports;}
  return {values,logs,wx,reload};
}
test('processing consent requires an explicit choice and persists through app restarts',()=>{
  const d=device(),consent=d.reload();assert.equal(consent.isAccepted(),false);assert.equal(d.values.size,0);
  consent.accept();assert.equal(d.reload().isAccepted(),true);
  const record=d.values.get(consent.KEY);assert.deepEqual(Object.keys(record).sort(),['acceptedAt','version']);assert.equal(record.version,consent.VERSION);
});
test('policy version change and revocation require fresh confirmation on every page',()=>{
  const d=device(),first=d.reload(),second=d.reload();first.accept();assert.equal(second.isAccepted(),true);
  d.values.get(first.KEY).version='older-policy';assert.equal(second.isAccepted(),false);
  first.accept();assert.equal(second.isAccepted(),true);second.revoke();assert.equal(first.isAccepted(),false);assert.equal(d.values.size,0);
});
test('blocked storage and unpersisted writes never fall back to in-memory consent',()=>{
  const d=device(),consent=d.reload();d.wx.setStorageSync=()=>{};
  assert.throws(()=>consent.accept(),{code:'CONSENT_STORAGE_ACCEPT'});assert.equal(consent.isAccepted(),false);
  d.wx.getStorageSync=()=>{throw new Error('storage unavailable');};assert.throws(()=>consent.isAccepted(),{code:'CONSENT_STORAGE_READ'});assert.ok(d.logs.length);
});
test('failed revocation is reported and a corrupt record can be explicitly cleared',()=>{
  const d=device(),consent=d.reload();consent.accept();const remove=d.wx.removeStorageSync;d.wx.removeStorageSync=()=>{};
  assert.throws(()=>consent.revoke(),{code:'CONSENT_STORAGE_REVOKE'});assert.equal(consent.isAccepted(),true);
  d.values.set(consent.KEY,{version:consent.VERSION});assert.throws(()=>consent.isAccepted(),{code:'CONSENT_STORAGE_READ'});
  d.wx.removeStorageSync=remove;consent.revoke();assert.equal(consent.isAccepted(),false);
});
