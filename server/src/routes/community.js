import { CONCEPTS, suggestions } from '../services/discoveryPreferences.js';
export function registerCommunityRoutes(router,{repos,requireUser}) {
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
  return route;
}
