import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function worker({response,path='/groups',windows=[]}={}) {
  const listeners={},shown=[],calls=[];
  const self={location:{origin:'https://encore.example'},addEventListener:(type,handler)=>{listeners[type]=handler;},
    clients:{async matchAll(){return windows;},async openWindow(url){calls.push(url);}},
    registration:{async showNotification(title,options){shown.push({title,...options});}}};
  const fetch=async(url,options)=>{
    calls.push({url,options});return response??{ok:true,async json(){return {notification:{id:'n1',title:'A new message',path}};}};
  };
  runInNewContext(readFileSync(new URL('../../client/public/sw.js',import.meta.url),'utf8'),{self,fetch,URL});
  return {listeners,shown,calls};
}

async function push(instance,payload={notificationId:'n1',subscriptionId:'s1'}) {
  let completion;
  instance.listeners.push({data:{json:()=>payload},waitUntil:(promise)=>{completion=promise;}});
  await completion;
}

test('service worker rechecks authenticated notification and gives safe route to click handler',async()=>{
  const messages=[];const instance=worker({windows:[{postMessage:(data)=>messages.push(data)}]});
  await push(instance);
  assert.equal(instance.shown.length,1);assert.equal(instance.shown[0].body,'A new message');
  assert.equal(instance.shown[0].data.path,'/groups');assert.equal(messages.length,1);
  assert.equal(instance.calls[0].options.credentials,'same-origin');assert.equal(instance.calls[0].options.cache,'no-store');
});

test('queued push after logout or read does not reveal title on shared device',async()=>{
  for(const status of [401,404]) {
    const instance=worker({response:{ok:false,status}});await push(instance);
    assert.equal(instance.shown.length,0);
  }
});

test('malformed push and cross-origin navigation are ignored',async()=>{
  const invalid=worker();await push(invalid,{unexpected:'content'});assert.equal(invalid.calls.length,0);
  const external=worker({path:'https://attacker.example'});await push(external);assert.equal(external.shown.length,0);
  let completion;external.listeners.notificationclick({notification:{close(){},data:{path:'https://attacker.example'}},waitUntil:(promise)=>{completion=promise;}});
  await completion;assert.equal(external.calls.length,1);
});

test('malformed notification lookup JSON and oversized push ids are ignored safely',async()=>{
  const jsonError=worker({response:{ok:true,async json(){throw new Error('invalid_json');}}});
  await push(jsonError);assert.equal(jsonError.shown.length,0);
  const invalid=worker({response:{ok:true,async json(){return {notification:{id:'n1',title:'x'.repeat(161),path:'/groups'}};}}});
  await push(invalid);assert.equal(invalid.shown.length,0);
  const oversized=worker();await push(oversized,{notificationId:'x'.repeat(129),subscriptionId:'s1'});
  assert.equal(oversized.calls.length,0);
});

test('notification click focuses an existing app window on its same-origin route',async()=>{
  const opened=[];const instance=worker({windows:[{url:'https://encore.example/',async navigate(url){opened.push(url);},async focus(){opened.push('focus');}}]});
  let completion;instance.listeners.notificationclick({notification:{close(){},data:{path:'/meetups/m1'}},waitUntil:(promise)=>{completion=promise;}});
  await completion;assert.deepEqual(opened,['https://encore.example/meetups/m1','focus']);
});
