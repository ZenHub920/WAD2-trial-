import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { migrateDelivery, createJobRepository } from '../src/db/deliveryRepository.js';
import { createDeliveryService, validatePushSubscription } from '../src/services/delivery.js';
import { registerPushRoutes } from '../src/routes/push.js';
import { makeUser, makeParty, makeSeeker } from './helpers.js';

let db,repos,clock,sendCalls,service;
const env={VAPID_PUBLIC_KEY:'public-key',VAPID_PRIVATE_KEY:'private-key',VAPID_SUBJECT:'mailto:test@example.org'};
const subscription=(suffix='one')=>({endpoint:`https://fcm.googleapis.com/fcm/send/${suffix}`,
  keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}});
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
  assert.equal(service.notification('member','n1',id).title,'Private notification title');
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

test('account switch rotates subscription identity so old jobs cannot reach the new owner',async()=>{
  const old=service.subscribe('member',subscription());notification();
  const next=service.subscribe('other',subscription());assert.notEqual(old.id,next.id);
  assert.equal(service.notification('other','n1',old.id),null);
  await service.runOnce();assert.equal(sendCalls.length,0);
  service.unsubscribe('member',subscription().endpoint);
  assert.equal(db.prepare('SELECT user_id FROM push_subscriptions').get().user_id,'other');
  service.unsubscribe('other',subscription().endpoint);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,0);
});

test('suspended users cannot retrieve or receive queued popups and the device limit applies to transfers',async()=>{
  const {id}=service.subscribe('member',subscription());notification();
  db.exec('CREATE TABLE IF NOT EXISTS account_security(user_id TEXT PRIMARY KEY,suspended_at INTEGER)');
  db.prepare('INSERT INTO account_security(user_id,suspended_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET suspended_at=excluded.suspended_at')
    .run('member',clock);
  assert.equal(service.notification('member','n1',id),null);await service.runOnce();assert.equal(sendCalls.length,0);
  for(let i=0;i<10;i++) service.subscribe('other',subscription(`other-${i}`));
  assert.throws(()=>service.subscribe('other',subscription()),/push_subscription_limit/);
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
    const result=await fetch(`${base}/me/push/config`,{headers:{'x-user':'member'}});
    assert.deepEqual(await result.json(),{configured:true,publicKey:'public-key'});
    const {id}=service.subscribe('member',subscription());notification();
    const other=await fetch(`${base}/me/push/notifications/n1?subscriptionId=${id}`,{headers:{'x-user':'other'}});
    assert.equal(other.status,404);assert.equal(other.headers.get('cache-control'),'no-store');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
