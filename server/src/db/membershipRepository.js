import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { validateAnswers, aggregateAnswers } from '../services/discoveryPreferences.js';
export const communityError=(message,status=409)=>Object.assign(new Error(message),{status});
const hash=token=>createHash('sha256').update(token).digest('hex');
export function createMembershipRepo(db,repos) {
  const party=id=>{const p=repos.parties.findById(id);if(!p)throw communityError('group_not_found',404);return p;};
  const owner=(user,id)=>{const p=party(id);if(p.host_user_id!==user)throw communityError('host_required',403);return p;};
  const member=(user,id)=>db.prepare("SELECT * FROM group_memberships WHERE party_id=? AND user_id=? AND status='active'").get(id,user);
  const active=(user,concert)=>db.prepare("SELECT * FROM group_memberships WHERE user_id=? AND concert_id=? AND status='active'").get(user,concert);
  const ensureFree=(user,concert,id)=>{
    const current=active(user,concert);
    const hosted=db.prepare("SELECT id FROM parties WHERE host_user_id=? AND concert_id=? AND status<>'cancelled' AND id<>?").get(user,concert,id);
    if((current&&current.party_id!==id)||hosted)throw communityError('already_in_concert_group');
    const pending=db.prepare(`SELECT 1 FROM match_proposals mp JOIN seeker_requests s ON s.id=mp.seeker_request_id
      WHERE s.user_id=? AND s.concert_id=? AND mp.party_id<>? AND (mp.status='confirmed' OR(mp.status='proposed' AND mp.expires_at>?))`).get(user,concert,id,Date.now());
    if(pending)throw communityError('active_matching_proposal_exists');
  };
  const attach=(p,user,source)=>{
    ensureFree(user,p.concert_id,p.id);
    db.prepare(`INSERT INTO group_memberships(party_id,user_id,concert_id,source) VALUES(?,?,?,?)
      ON CONFLICT(party_id,user_id) DO UPDATE SET status='active',source=excluded.source,joined_at=datetime('now'),left_at=NULL`).run(p.id,user,p.concert_id,source);
  };
  const settings=id=>db.prepare('SELECT * FROM group_settings WHERE party_id=?').get(id);
  const profile=id=>{
    const rows=db.prepare(`SELECT pref.answers_json FROM group_memberships m JOIN group_member_preferences pref
      ON pref.party_id=m.party_id AND pref.user_id=m.user_id WHERE m.party_id=? AND m.status='active'`).all(id);
    return aggregateAnswers(rows.map(r=>JSON.parse(r.answers_json)));
  };
  return {party,owner,member,active,ensureFree,attach,settings,profile,
    activeGroups(user) {
      return db.prepare(`SELECT p.id,p.concert_id AS concertId,c.artist,m.source FROM group_memberships m
        JOIN parties p ON p.id=m.party_id JOIN concerts c ON c.id=p.concert_id
        WHERE m.user_id=? AND m.status='active' AND p.status<>'cancelled' ORDER BY c.event_date,p.id`).all(user);
    },
    configure:db.transaction((user,id,input={})=>{
      const p=owner(user,id);ensureFree(user,p.concert_id,id);
      const expected=input.expectedFriends??0;
      if(!Number.isInteger(expected)||expected<0||expected>100)throw communityError('invalid_expected_friends',400);
      const friends=db.prepare("SELECT COUNT(*) n FROM group_memberships WHERE party_id=? AND source='friend' AND status='active'").get(id).n;
      if(expected<friends)throw communityError('expected_friends_below_current_members');
      if(db.prepare('SELECT 1 FROM membership_conflicts WHERE party_id=?').get(id))throw communityError('legacy_membership_conflict');
      attach(p,user,'host');
      db.prepare(`INSERT INTO group_settings(party_id,expected_friends) VALUES(?,?)
        ON CONFLICT(party_id) DO UPDATE SET expected_friends=excluded.expected_friends,published=0`).run(id,expected);
      return settings(id);
    }).immediate,
    saveAnswers:db.transaction((user,id,input)=>{
      if(!member(user,id))throw communityError('group_member_required',403);
      const answers=validateAnswers(input);
      db.prepare(`INSERT INTO group_member_preferences VALUES(?,?,?,datetime('now'))
        ON CONFLICT(party_id,user_id) DO UPDATE SET answers_json=excluded.answers_json,updated_at=excluded.updated_at`).run(id,user,JSON.stringify(answers));
      return profile(id);
    }).immediate,
    detail(user,id) {
      const p=party(id);if(p.host_user_id!==user&&!member(user,id))throw communityError('group_member_required',403);
      const members=db.prepare(`SELECT m.user_id AS id,u.display_name AS name,m.source,
        pref.answers_json IS NOT NULL AS answered FROM group_memberships m JOIN users u ON u.id=m.user_id
        LEFT JOIN group_member_preferences pref ON pref.party_id=m.party_id AND pref.user_id=m.user_id
        WHERE m.party_id=? AND m.status='active' ORDER BY m.joined_at,m.user_id`).all(id);
      return {partyId:id,hostId:p.host_user_id,concertId:p.concert_id,settings:settings(id),members,profile:profile(id),
        myAnswers:JSON.parse(db.prepare('SELECT answers_json FROM group_member_preferences WHERE party_id=? AND user_id=?').get(id,user)?.answers_json??'{}')};
    },
    publish:db.transaction((user,id,input={})=>{
      const p=owner(user,id),s=settings(id);if(!s||p.status==='cancelled')throw communityError('group_unavailable');
      const detail=repos.membership.detail(user,id);
      const friends=detail.members.filter(m=>m.source==='friend').length;
      if(friends!==s.expected_friends||detail.members.some(m=>!m.answered))throw communityError('members_or_preferences_incomplete');
      db.prepare('UPDATE group_settings SET published=1,connect_open=? WHERE party_id=?').run(input.connectOpen===true?1:0,id);
      return settings(id);
    }).immediate,
    invite:db.transaction((user,id)=>{
      const p=owner(user,id),s=settings(id);if(!s||p.status==='cancelled')throw communityError('configure_group_first');
      const token=randomBytes(32).toString('hex'),inviteId=`fi_${randomUUID()}`;
      db.prepare('INSERT INTO group_friend_invites(id,party_id,token_hash,expires_at) VALUES(?,?,?,?)').run(inviteId,id,hash(token),Date.now()+7*86400000);
      return {id:inviteId,token,path:`/groups/invite/${token}`,expiresInDays:7};
    }).immediate,
    acceptInvite:db.transaction((user,token)=>{
      if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw communityError('invitation_not_found',404);
      const invite=db.prepare('SELECT * FROM group_friend_invites WHERE token_hash=?').get(hash(token));
      if(!invite||invite.revoked||invite.expires_at<=Date.now())throw communityError('invitation_unavailable');
      if(invite.accepted_by) {if(invite.accepted_by===user)return {partyId:invite.party_id};throw communityError('invitation_used');}
      const p=party(invite.party_id),s=settings(p.id);
      if(p.status==='cancelled'||!s)throw communityError('group_unavailable');
      if(member(user,p.id))throw communityError('already_group_member');
      const blocks=repos.users.blocklist();
      if(blocks.has(`${user}:${p.host_user_id}`)||blocks.has(`${p.host_user_id}:${user}`))throw communityError('blocked_pair',403);
      const friends=db.prepare("SELECT COUNT(*) n FROM group_memberships WHERE party_id=? AND source='friend' AND status='active'").get(p.id).n;
      if(friends>=s.expected_friends)throw communityError('friend_places_full');
      attach(p,user,'friend');
      db.prepare("UPDATE group_friend_invites SET accepted_by=?,accepted_at=datetime('now') WHERE id=?").run(user,invite.id);
      db.prepare('UPDATE group_settings SET published=0 WHERE party_id=?').run(p.id);
      return {partyId:p.id};
    }).immediate,
    leave:db.transaction((user,id)=>{
      const p=party(id);if(p.host_user_id===user)throw communityError('host_must_cancel_group');
      if(!member(user,id))throw communityError('group_member_required',403);
      db.prepare("UPDATE group_memberships SET status='left',left_at=datetime('now') WHERE party_id=? AND user_id=?").run(id,user);
      db.prepare('UPDATE group_settings SET published=0 WHERE party_id=?').run(id);
      db.prepare(`UPDATE match_proposals SET status='cancelled' WHERE party_id=? AND seeker_request_id IN
        (SELECT id FROM seeker_requests WHERE user_id=?) AND status IN('proposed','confirmed')`).run(id,user);
      if(p.status==='matched')repos.parties.setStatus(id,'open');
      db.prepare("UPDATE seeker_requests SET status='withdrawn' WHERE user_id=? AND concert_id=?").run(user,p.concert_id);
      return {left:true};
    }).immediate,
    cancel:db.transaction((user,id)=>{
      const p=owner(user,id);
      db.prepare("UPDATE parties SET status='cancelled' WHERE id=?").run(id);
      db.prepare("UPDATE group_memberships SET status='left',left_at=datetime('now') WHERE party_id=?").run(id);
      db.prepare("UPDATE seeker_requests SET status='open' WHERE id IN(SELECT seeker_request_id FROM match_proposals WHERE party_id=? AND status IN('proposed','confirmed'))").run(id);
      db.prepare("UPDATE match_proposals SET status='cancelled' WHERE party_id=? AND status IN('proposed','confirmed')").run(id);
      db.prepare("UPDATE group_join_requests SET status='rejected',responded_at=datetime('now') WHERE party_id=? AND status='pending'").run(id);
      db.prepare('UPDATE group_friend_invites SET revoked=1 WHERE party_id=?').run(id);
      db.prepare('UPDATE group_settings SET published=0 WHERE party_id=?').run(id);
      return {cancelled:true,concertId:p.concert_id};
    }).immediate,
  };
}
