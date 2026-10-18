import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CloudStore, hash } from '../cloud/store.js';

const requireCloud=createRequire(new URL('../cloudfunctions/lightToolbox/package.json',import.meta.url));
const {Db}=requireCloud('@cloudbase/database');
const {EJSON}=requireCloud('bson');

test('real Node SDK serializes top-level user/order fields and transaction results correctly',async()=>{
  const original=Db.reqClass,documents=new Map(),writes=[];
  // Only the network boundary is replaced. All SDK document/transaction code,
  // validation and EJSON serialization run as deployed.
  Db.reqClass=class {
    async send(action,p={}) {
      if(action==='database.startTransaction')return {transactionId:'sdk-contract'};
      if(['database.commitTransaction','database.abortTransaction'].includes(action))return {};
      const id=EJSON.parse(p.query)._id,key=p.collectionName+'/'+id;
      if(action==='database.getDocument')return {data:{list:documents.has(key)?[EJSON.stringify(documents.get(key))]:[]}};
      if(action==='database.modifyDocument') {
        const value=EJSON.parse(p.data);writes.push(value);
        documents.set(key,p.merge?{...documents.get(key),...value.$set}:{...value,_id:id});
        return {data:{updated:1,upsert_id:id}};
      }
      throw new Error('Unexpected SDK action: '+action);
    }
  };
  try {
    const store=new CloudStore(new Db({env:'sdk-contract',throwOnCode:true}));
    const order=await store.createOrder('alice','single','one',100);
    assert.equal(order.price,100);
    assert.equal(documents.get('light_users/'+hash('alice')).user_id,'alice');
    assert.equal(documents.get('light_orders/'+order.id).status,'created');
    assert.ok(writes.every(row=>!Object.hasOwn(row,'data')));
    await store.updateOrder(order.id,{delivered:true});
    assert.equal((await store.order(order.id)).delivered,true);
  } finally {Db.reqClass=original;}
});

test('deployment uses patched official database and Axios without vulnerable Lodash method packages',()=>{
  assert.equal(requireCloud('@cloudbase/database/package.json').version,'1.5.1');
  assert.throws(()=>requireCloud.resolve('lodash.set'),{code:'MODULE_NOT_FOUND'});
  assert.throws(()=>requireCloud.resolve('lodash.unset'),{code:'MODULE_NOT_FOUND'});
  assert.equal(requireCloud('axios/package.json').version,'0.34.0');
});
