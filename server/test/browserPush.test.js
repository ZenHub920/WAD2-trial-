import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function browser({linked=false,registrationFails=false}={}) {
  const calls=[];
  const old={endpoint:'https://fcm.googleapis.com/old',options:{},toJSON(){return {endpoint:this.endpoint,keys:{}};},async unsubscribe(){calls.push('unsubscribe-old');return true;}};
  const fresh={endpoint:'https://fcm.googleapis.com/new',toJSON(){return {endpoint:this.endpoint,keys:{}};},async unsubscribe(){calls.push('unsubscribe-new');return true;}};
  let current=old;
  const registration={pushManager:{async getSubscription(){return current;},async subscribe(){calls.push('subscribe-new');current=fresh;return fresh;}}};
  const context={Uint8Array,atob,window:{isSecureContext:true,PushManager(){},Notification:{}},
    Notification:{permission:'granted',async requestPermission(){return 'granted';}},
    navigator:{serviceWorker:{ready:Promise.resolve(registration),async register(){},async getRegistration(){return registration;}}},
    async fetch(path,options){
      calls.push({path,options});
      if(path.endsWith('/config'))return {ok:true,json:async()=>({configured:true,publicKey:'AQID'})};
      if(path.endsWith('/status'))return {ok:true,json:async()=>({enabled:current===fresh||linked})};
      if(options.method==='POST'&&registrationFails)return {ok:false,status:409,json:async()=>({error:'push_subscription_conflict'})};
      return {ok:true,json:async()=>({subscribed:true})};
    }};
  runInNewContext(readFileSync(new URL('../../client/src/browserPush.js',import.meta.url),'utf8').replaceAll('export ',''),context);
  return {context,calls};
}

test('enabling on a shared browser creates a fresh subscription rather than transferring another account endpoint',async()=>{
  const {context,calls}=browser();
  const status=await context.enableBrowserPush();assert.equal(status.enabled,true);
  assert.ok(calls.indexOf('unsubscribe-old')<calls.indexOf('subscribe-new'));
  const deletion=calls.find(call=>typeof call==='object' && call.options.method==='DELETE');
  assert.equal(deletion,undefined);
  const registration=calls.find(call=>typeof call==='object' && call.path.endsWith('/subscriptions'));
  assert.equal(JSON.parse(registration.options.body).endpoint,'https://fcm.googleapis.com/new');
});

test('registration conflicts unsubscribe the fresh local device capability instead of leaving delivery enabled',async()=>{
  const {context,calls}=browser({registrationFails:true});
  await assert.rejects(context.enableBrowserPush(),/push_subscription_conflict/);
  assert.ok(calls.includes('unsubscribe-new'));
});

test('an already linked browser reuses its subscription without creating duplicate devices',async()=>{
  const {context,calls}=browser({linked:true});
  await context.enableBrowserPush();
  assert.equal(calls.includes('subscribe-new'),false);
  assert.equal(calls.includes('unsubscribe-old'),false);
});
