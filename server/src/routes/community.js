import { CONCEPTS, suggestions } from '../services/discoveryPreferences.js';
import { createMeetupWeather } from '../services/meetupWeather.js';
export function registerCommunityRoutes(router,{repos,requireUser}) {
  const weather=createMeetupWeather();
  const route=(method,path,key,fn)=>router[method](path,requireUser,(req,res,next)=>{
    try{const result=fn(req);res.json({[key]:result});}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}
  });
  route('put','/groups/:id/settings','settings',r=>repos.membership.configure(r.user.id,r.params.id,r.body));
  route('get','/groups/:id/membership','group',r=>repos.membership.detail(r.user.id,r.params.id));
  route('put','/groups/:id/member-preferences','profile',r=>repos.membership.saveAnswers(r.user.id,r.params.id,r.body));
  route('post','/groups/:id/publish','settings',r=>repos.membership.publish(r.user.id,r.params.id,r.body));
  route('post','/groups/:id/friend-invites','invitation',r=>repos.membership.invite(r.user.id,r.params.id));
  route('post','/group-friend-invites/:token/accept','membership',r=>repos.membership.acceptInvite(r.user.id,r.params.token));
  route('post','/groups/:id/leave','membership',r=>repos.membership.leave(r.user.id,r.params.id));
  route('post','/groups/:id/cancel','group',r=>repos.membership.cancel(r.user.id,r.params.id));
  route('get','/me/attendance-groups','groups',r=>repos.membership.activeGroups(r.user.id));
  route('get','/preference-concepts','concepts',r=>typeof r.query.q==='string'?suggestions(r.query.q):CONCEPTS);
  route('get','/me/discovery-preferences/:concertId','preferences',r=>repos.recommendations.answers(r.user.id,r.params.concertId));
  route('put','/me/discovery-preferences/:concertId','preferences',r=>repos.recommendations.savePersonal(r.user.id,r.params.concertId,r.body));
  route('post','/groups/:id/join-requests','request',r=>repos.recommendations.requestJoin(r.user.id,r.params.id));
  route('get','/me/group-join-requests','requests',r=>repos.recommendations.requests(r.user.id));
  route('post','/group-join-requests/:id/respond','request',r=>repos.recommendations.respond(r.user.id,r.params.id,r.body?.action));
  route('get','/me/notifications','notifications',r=>repos.notifications.list(r.user.id,r.query));
  route('get','/me/notifications/unread','unread',r=>repos.notifications.unread(r.user.id));
  route('post','/me/notifications/read-all','result',r=>repos.notifications.readAll(r.user.id));
  route('post','/me/notifications/:id/read','result',r=>repos.notifications.read(r.user.id,r.params.id));
  route('get','/me/notification-preferences','preferences',r=>repos.notifications.settings(r.user.id));
  route('put','/me/notification-preferences','result',r=>repos.notifications.setSettings(r.user.id,r.body));
  route('get','/me/meetups','meetups',r=>repos.meetups.list(r.user.id));
  route('post','/meetups','meetup',r=>repos.meetups.create(r.user.id,r.body));
  route('get','/meetups/:id','meetup',r=>repos.meetups.detail(r.user.id,r.params.id));
  route('put','/meetups/:id/availability','result',r=>repos.meetups.availability(r.user.id,r.params.id,r.body?.windows));
  route('post','/meetups/:id/places','place',r=>repos.meetups.place(r.user.id,r.params.id,r.body));
  route('put','/meetups/:id/vote','result',r=>repos.meetups.vote(r.user.id,r.params.id,r.body?.placeId));
  route('post','/meetups/:id/comments','comment',r=>repos.meetups.comment(r.user.id,r.params.id,r.body?.body));
  route('post','/meetups/:id/propose','proposal',r=>repos.meetups.propose(r.user.id,r.params.id,r.body));
  route('post','/meetups/:id/approve','approval',r=>repos.meetups.approve(r.user.id,r.params.id,r.body?.version));
  router.get('/meetups/:id/weather',requireUser,async(req,res,next)=>{
    try{const m=repos.meetups.detail(req.user.id,req.params.id);const place=m.places.find(p=>p.id===m.selected_place_id);
      if(!place)return res.json({weather:{status:'unavailable',reason:'choose_a_meeting_place_and_time_first'}});
      return res.json({weather:await weather.forecast({...place,startsAt:m.selected_start})});
    }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}
  });
  return route;
}
