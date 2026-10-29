import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import express from 'express';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { migrateDelivery, createJobRepository } from '../src/db/deliveryRepository.js';
import { createDeliveryService, validatePushSubscription } from '../src/services/delivery.js';
import { registerPushRoutes } from '../src/routes/push.js';
import { makeUser, makeParty, makeSeeker } from './helpers.js';

let db,repos,clock,sendCalls,service;
const env={VAPID_PUBLIC_KEY:'public-key',VAPID_PRIVATE_KEY:'private-key',VAPID_SUBJECT:'mailto:test@example.org'};
const receiver=createECDH('prime256v1');receiver.generateKeys();
const subscription=(suffix='one')=>({endpoint:`https://fcm.googleapis.com/fcm/send/${suffix}`,
  keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}});
function notification({user='member',id='n1',category='group',path='/groups'}={}) {
  db.prepare(`INSERT INTO notifications(id,user_id,category,event_key,title,resource_path) VALUES(?,?,?,?,?,?)`)
    .run(id,user,category,`event:${id}`,'Private notification title',path);
}
beforeEach(()=>{
  db=createTestDb();migrateDelivery(db);repos=createRepositories(db);
  clock=Date.now()+1000;sendCalls=[];
  for(const id of ['host','member','other']) repos.users.create(makeUser(id));
  repos.concerts.create({id:'c1',artist:'Act',venue:'Hall',city:'Singapore',event_date:'2027-10-20'});
  repos.parties.create(makeParty('p1',makeUser('host'),{capacity:3}));
  db.prepare(`INSERT INTO group_memberships(party_id,user_id,concert_id,source,status) VALUES('p1','member','c1','friend','active')`).run();
  repos.groupChannels.open('p1','host');repos.groupChannels.add('p1','host','member');
  service=createDeliveryService({db,repos,env,now:()=>clock,logger:{warn(){}},webPush:{async sendNotification(...args){sendCalls.push(args);}}});
});
afterEach(async()=>{await service.stop();db.close();});

test('blocking after enqueue suppresses both the group popup and its authenticated title', async()=>{
  const {id:subscriptionId}=service.subscribe('member',subscription());
  repos.groupChannels.send('p1','host','Hello');
  const note=db.prepare("SELECT id FROM notifications WHERE user_id='member'").get();
  repos.users.block('member','host');
  assert.equal(service.notification('member',note.id,subscriptionId),null);
  await service.runOnce();
  assert.equal(sendCalls.length,0);
});

test('subscriptions validate push provider URLs and key shapes before storing any network target',()=>{
  assert.ok(validatePushSubscription(subscription()));
  for(const endpoint of ['http://fcm.googleapis.com/p','https://127.0.0.1/p','https://fcm.googleapis.com.attacker.test/p',
    'https://user:pass@fcm.googleapis.com/p','https://fcm.googleapis.com:8443/p','https://metadata.google.internal/p'])
    assert.throws(()=>validatePushSubscription({...subscription(),endpoint}),/invalid_push_endpoint/);
  assert.throws(()=>validatePushSubscription({...subscription(),keys:{auth:'bad',p256dh:'bad'}}),/invalid_push_keys/);
  assert.deepEqual(service.publicConfig(),{configured:true,publicKey:'public-key'});
  assert.equal(JSON.stringify(service.publicConfig()).includes('private-key'),false);
  assert.throws(()=>validatePushSubscription({...subscription(),keys:{...subscription().keys,
    p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url')}}),/invalid_push_keys/);
  assert.throws(()=>validatePushSubscription({...subscription(),keys:{...subscription().keys,
    auth:`${subscription().keys.auth}=`}}),/invalid_push_keys/);
});

test('duplicate device subscriptions are idempotent and never silently replace encryption keys',()=>{
  const first=service.subscribe('member',subscription());
  assert.deepEqual(service.subscribe('member',subscription()),first);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,1);
  assert.throws(()=>service.subscribe('member',{...subscription(),keys:{...subscription().keys,
    auth:Buffer.alloc(16,9).toString('base64url')}}),/push_subscription_conflict/);
  assert.equal(db.prepare('SELECT auth FROM push_subscriptions').get().auth,subscription().keys.auth);
});

test('a missing VAPID configuration never stores subscriptions or exposes partial secrets',async()=>{
  const worker=createDeliveryService({db,repos,env:{VAPID_PRIVATE_KEY:'private-only'},now:()=>clock});
  assert.deepEqual(worker.publicConfig(),{configured:false,publicKey:null});
  assert.throws(()=>worker.subscribe('member',subscription()),/push_not_configured/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,0);
  await worker.stop();
});

test('group message inbox and push jobs commit atomically and roll back together',()=>{
  service.subscribe('member',subscription());
  assert.throws(()=>db.transaction(()=>{
    repos.groupChannels.send('p1','host','Hello');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM background_jobs').get().n,1);
    throw new Error('rollback');
  })(),/rollback/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM group_channel_messages').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM background_jobs').get().n,0);
  repos.groupChannels.send('p1','host','First');repos.groupChannels.send('p1','host','Second');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE category='chat'").get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM background_jobs').get().n,1);
});

test('worker sends private-key options server-side and payload carries no message/title',async()=>{
  const {id}=service.subscribe('member',subscription());notification();
  await service.runOnce();
  assert.equal(sendCalls.length,1);
  assert.deepEqual(JSON.parse(sendCalls[0][1]),{notificationId:'n1',subscriptionId:id});
  assert.equal(sendCalls[0][2].vapidDetails.privateKey,'private-key');
  assert.equal(service.notification('other','n1',id),null);
  assert.equal(service.notification('member','n1',id).title,'You have a group update');
});

test('read, muted, old and revoked chat notifications are suppressed before delivery',async()=>{
  service.subscribe('member',subscription());notification();
  repos.notifications.read('member','n1');
  notification({id:'n2',category:'feedback',path:'/feedback'});
  repos.notifications.setSettings('member',{feedback:false});
  notification({id:'n3'});db.prepare("UPDATE notifications SET created_at=datetime('now','-2 days') WHERE id='n3'").run();
  repos.groupChannels.send('p1','host','Hello');
  repos.groupChannels.leave('p1','member');
  await service.runOnce();assert.equal(sendCalls.length,0);
});

test('another account cannot transfer, replace keys or delete an existing endpoint',async()=>{
  const old=service.subscribe('member',subscription());notification();
  assert.throws(()=>service.subscribe('other',subscription()),/push_subscription_conflict/);
  assert.throws(()=>service.subscribe('other',{...subscription(),keys:{...subscription().keys,auth:Buffer.alloc(16,3).toString('base64url')}}),/push_subscription_conflict/);
  assert.equal(service.notification('other','n1',old.id),null);
  service.unsubscribe('other',subscription().endpoint);
  assert.equal(db.prepare('SELECT user_id FROM push_subscriptions').get().user_id,'member');
  service.unsubscribe('member',subscription().endpoint);
  const next=service.subscribe('other',subscription('fresh-browser-capability'));assert.notEqual(old.id,next.id);
  await service.runOnce();assert.equal(sendCalls.length,0);
  service.unsubscribe('other',subscription('fresh-browser-capability').endpoint);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,0);
});

test('suspended users cannot retrieve or receive queued popups and each user has a device limit',async()=>{
  const {id}=service.subscribe('member',subscription());notification();
  db.exec('CREATE TABLE IF NOT EXISTS account_security(user_id TEXT PRIMARY KEY,suspended_at INTEGER)');
  db.prepare('INSERT INTO account_security(user_id,suspended_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET suspended_at=excluded.suspended_at')
    .run('member',clock);
  assert.equal(service.notification('member','n1',id),null);await service.runOnce();assert.equal(sendCalls.length,0);
  for(let i=0;i<10;i++) service.subscribe('other',subscription(`other-${i}`));
  assert.throws(()=>service.subscribe('other',subscription('extra')),/push_subscription_limit/);
  assert.equal(db.prepare('SELECT user_id FROM push_subscriptions WHERE id=?').get(id).user_id,'member');
});

test('410 removes an expired browser subscription; transient failures retry without storing secrets',async()=>{
  service.subscribe('member',subscription());notification();
  let fail=true;
  const worker=createDeliveryService({db,repos,env,now:()=>clock,logger:{warn(){}},webPush:{async sendNotification(){
    if(fail) throw Object.assign(new Error('PRIVATE PROVIDER BODY'),{statusCode:429,headers:{'retry-after':'20'}});
  }}});
  await worker.runOnce();
  let row=db.prepare("SELECT * FROM background_jobs WHERE type='notification.push'").get();
  assert.equal(row.status,'queued');assert.equal(row.last_error,'provider_429');assert.equal(row.available_at,clock+20000);
  fail=false;clock+=20001;await worker.runOnce();
  assert.equal(db.prepare('SELECT status FROM background_jobs WHERE id=?').get(row.id).status,'completed');
  const expired=createDeliveryService({db,repos,env,now:()=>clock,logger:{warn(){}},webPush:{async sendNotification(){throw {statusCode:410};}}});
  notification({id:'n2'});clock+=1000;await expired.runOnce();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,0);
});

test('invalid persisted endpoints never trigger outbound requests and only that device is removed',async()=>{
  const bad=service.subscribe('member',subscription('bad'));service.subscribe('member',subscription('good'));
  db.prepare('UPDATE push_subscriptions SET endpoint=? WHERE id=?').run('https://127.0.0.1/private',bad.id);
  notification();await service.runOnce();
  assert.equal(sendCalls.length,1);
  assert.equal(sendCalls[0][0].endpoint,subscription('good').endpoint);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,1);
});

test('404 cleans one invalid device and permanent configuration rejection has no retry loop',async()=>{
  const gone=service.subscribe('member',subscription('gone'));service.subscribe('member',subscription('valid'));notification();
  let attempts=0;
  const worker=createDeliveryService({db,repos,env,now:()=>clock,logger:{warn(){}},webPush:{async sendNotification(s){
    attempts++;throw {statusCode:s.endpoint===subscription('gone').endpoint?404:401};
  }}});
  await worker.runOnce();
  assert.equal(attempts,2);assert.equal(db.prepare('SELECT 1 FROM push_subscriptions WHERE id=?').get(gone.id),undefined);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,1);
  const permanent=db.prepare("SELECT * FROM background_jobs WHERE type='notification.push' AND status='dead'").get();
  assert.equal(permanent.attempts,1);assert.equal(permanent.last_error,'provider_401');
  clock+=3600001;await worker.runOnce();assert.equal(attempts,2);
});

test('transient retries stop after six attempts and batch sizes are bounded',async()=>{
  service.subscribe('member',subscription());notification();let attempts=0;
  const worker=createDeliveryService({db,repos,env,now:()=>clock,logger:{warn(){}},webPush:{async sendNotification(){attempts++;throw {statusCode:503};}}});
  for(let i=0;i<10;i++){await worker.runOnce();clock+=3600001;}
  assert.equal(attempts,6);
  const row=db.prepare("SELECT * FROM background_jobs WHERE type='notification.push'").get();
  assert.equal(row.status,'dead');assert.equal(row.attempts,6);assert.ok(row.completed_at);
  for(const maxJobs of [0,101,Infinity,NaN,1.5]) await assert.rejects(worker.runOnce({maxJobs}),/invalid_job_batch_size/);
});

test('completed queue retention is bounded and cannot delete live or recent work',()=>{
  const jobs=createJobRepository(db,{now:()=>clock});
  for(let i=0;i<4;i++) {
    jobs.enqueue({key:`old:${i}`,type:'test'});const job=jobs.claim('worker');jobs.complete(job);
  }
  clock+=31*86400000;
  jobs.enqueue({key:'live',type:'test'});
  assert.equal(jobs.prune(undefined,2),2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM background_jobs WHERE status='completed'").get().n,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM background_jobs WHERE status='queued'").get().n,1);
  assert.equal(jobs.nextAvailableAt(),clock);
  assert.throws(()=>jobs.enqueue({key:'oversized',type:'test',payload:{value:'x'.repeat(17000)}}),/invalid_background_job/);
});

test('retention drains a historical backlog in delayed bounded batches and stops when caught up',async()=>{
  clock=Math.floor(clock/3600000)*3600000+1000;
  const old=clock-31*86400000;
  const insert=db.prepare(`INSERT INTO background_jobs(id,job_key,type,payload_json,available_at,status,created_at,completed_at)
    VALUES(?,?,'retention.fixture','{}',?,?,?,?)`);
  db.transaction(()=>{
    for(let i=0;i<2050;i++) insert.run(`aged-${i}`,`aged:${i}`,old,'completed',old,old);
    insert.run('recent','recent',clock,'completed',clock,clock);
  })();
  service.enqueue({key:'live',type:'retention.fixture',availableAt:clock+86400000});
  const aged=()=>db.prepare("SELECT COUNT(*) n FROM background_jobs WHERE job_key LIKE 'aged:%'").get().n;
  const pending=()=>db.prepare("SELECT COUNT(*) n FROM background_jobs WHERE job_key LIKE 'cleanup:followup:%' AND status='queued'").get().n;
  await service.runOnce();assert.equal(aged(),1050);assert.equal(pending(),1);
  await service.runOnce();assert.equal(aged(),1050);assert.equal(pending(),1);
  clock+=60001;await service.runOnce();assert.equal(aged(),50);assert.equal(pending(),1);
  clock+=60001;await service.runOnce();assert.equal(aged(),0);assert.equal(pending(),0);
  await service.runOnce();assert.equal(pending(),0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM background_jobs WHERE job_key LIKE 'cleanup:followup:%'").get().n,2);
  assert.equal(db.prepare("SELECT status FROM background_jobs WHERE job_key='live'").get().status,'queued');
  assert.equal(db.prepare("SELECT status FROM background_jobs WHERE job_key='recent'").get().status,'completed');
});

test('an event wake delivers queued work before the long idle reconciliation interval',async()=>{
  service.subscribe('member',subscription());
  service.start({intervalMs:60000});
  await service.runOnce();
  notification();service.wake();
  const deadline=Date.now()+10000;
  while(sendCalls.length===0 && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(sendCalls.length,1);
  service.wake();await service.runOnce();
  assert.equal(sendCalls.length,1);
});

test('job leases prevent concurrent claims and recover after crash with owner-guarded completion',()=>{
  const jobs=createJobRepository(db,{now:()=>clock,leaseMs:1000,maxAttempts:2});
  jobs.enqueue({key:'test',type:'work'});const first=jobs.claim('first');
  assert.equal(jobs.claim('second'),null);clock+=1001;
  const second=jobs.claim('second');assert.equal(second.id,first.id);assert.equal(second.attempts,2);
  assert.equal(jobs.complete(first),0);assert.equal(jobs.complete(second),1);
  jobs.enqueue({key:'test',type:'work'});assert.equal(db.prepare("SELECT COUNT(*) n FROM background_jobs WHERE job_key='test'").get().n,1);
});

test('reminder scans deduplicate confirmed meetup reminders and respect current membership and categories',async()=>{
  const start=Math.ceil((clock+1800000)/1800000)*1800000;
  db.prepare(`INSERT INTO meetups(id,creator_id,party_id,title,starts_at,ends_at,status,selected_start)
    VALUES('m1','host','p1','Before show',?,?,'confirmed',?)`).run(start,start+1800000,start);
  await service.runOnce();await service.runOnce();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE event_key LIKE 'reminder:meetup:%'").get().n,2);
  clock+=300001;await service.runOnce();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE event_key LIKE 'reminder:meetup:%'").get().n,2);
});

test('lifecycle worker expires requests without traffic and delegates reservation promotion to existing transaction',async()=>{
  repos.seekers.create(makeSeeker('s1',makeUser('other')));
  repos.recommendations.setJoiningMode('other','c1','direct');
  const {id}=repos.recommendations.requestJoin('other','p1');
  db.prepare('UPDATE group_join_requests SET expires_at=? WHERE id=?').run(Date.now()-1000,id);
  await service.runOnce();
  assert.equal(db.prepare('SELECT status FROM group_join_requests WHERE id=?').get(id).status,'expired');
});

test('registered periodic tasks are durable and run once per schedule bucket without auto-start',async()=>{
  let ran=0;service.registerTask('test.external-sync',()=>{ran++;},{intervalMs:60000});
  assert.equal(ran,0);await service.runOnce();await service.runOnce();assert.equal(ran,1);
  clock+=60001;await service.runOnce();assert.equal(ran,2);
  migrateDelivery(db);assert.ok(db.prepare("SELECT 1 FROM background_jobs WHERE type='test.external-sync'").get());
});

test('weather worker warns current participants only for a fresh available forecast and deduplicates a plan version',async()=>{
  const start=clock+1800000;
  db.prepare(`INSERT INTO meetups(id,creator_id,party_id,title,starts_at,ends_at,status,selected_start,selected_place_id)
    VALUES('m1','host','p1','Before show',?,?,'confirmed',?,'place1')`).run(start,start+1800000,start);
  db.prepare(`INSERT INTO meetup_places(id,meetup_id,proposed_by,label,latitude,longitude) VALUES('place1','m1','host','MRT',1.3,103.8)`).run();
  let stale=true;service.registerWeatherChecks({async forecast(){return {status:'available',rainWarning:true,stale};}},{intervalMs:60000});
  await service.runOnce();assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE event_key LIKE 'weather:%'").get().n,0);
  stale=false;clock+=60001;await service.runOnce();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE event_key LIKE 'weather:%'").get().n,2);
  clock+=60001;await service.runOnce();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE event_key LIKE 'weather:%'").get().n,2);
});

test('push routes require auth, scope subscriptions and never expose secret configuration',async()=>{
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{if(req.headers['x-user']) req.user={id:req.headers['x-user']};next();});
  const router=express.Router();registerPushRoutes(router,{delivery:service,requireUser:(req,res,next)=>req.user?next():res.status(401).json({error:'unauthorized'})});
  app.use(router);app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const denied=await fetch(`${base}/me/push/config`);assert.equal(denied.status,401);
    const unauthSubscribe=await fetch(`${base}/me/push/subscriptions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(subscription())});
    assert.equal(unauthSubscribe.status,401);
    const result=await fetch(`${base}/me/push/config`,{headers:{'x-user':'member'}});
    assert.deepEqual(await result.json(),{configured:true,publicKey:'public-key'});
    const {id}=service.subscribe('member',subscription());notification();
    const transfer=await fetch(`${base}/me/push/subscriptions`,{method:'POST',headers:{'content-type':'application/json','x-user':'other'},body:JSON.stringify(subscription())});
    assert.equal(transfer.status,409);
    assert.equal(transfer.headers.get('cache-control'),'no-store');
    const status=await fetch(`${base}/me/push/status`,{method:'POST',headers:{'content-type':'application/json','x-user':'other'},body:JSON.stringify({endpoint:subscription().endpoint})});
    assert.deepEqual(await status.json(),{enabled:false});
    const other=await fetch(`${base}/me/push/notifications/n1?subscriptionId=${id}`,{headers:{'x-user':'other'}});
    assert.equal(other.status,404);assert.equal(other.headers.get('cache-control'),'no-store');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
