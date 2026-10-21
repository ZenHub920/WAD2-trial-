/** Group identity always comes from the existing authenticated session. */
export function registerGroupDiscoveryRoutes(router, { repos, requireUser }) {
  const send = (res, result, key, status = 200) => result?.error
    ? res.status(result.status ?? 400).json({ error: result.error })
    : res.status(status).json({ [key]: result });
  const concertExists = (req, res, next) => repos.concerts.findById(req.params.concertId)
    ? next() : res.status(404).json({ error: 'concert_not_found' });
  const page = (req,res,groups) => {
    const limit=Number(req.query.limit??20),offset=Number(req.query.offset??0);
    if(!Number.isInteger(limit)||limit<1||limit>30||!Number.isInteger(offset)||offset<0)return res.status(400).json({error:'invalid_pagination'});
    const q=typeof req.query.q==='string'?req.query.q.trim().toLowerCase():'';
    const filtered=groups.filter(g=>(!q||[g.name,g.hostName,g.artist,g.notes,...(g.reasons??[]).map(r=>r.label)].join(' ').toLowerCase().includes(q))
      &&(!req.query.section||g.section===req.query.section)&&(!req.query.arrival||g.arrivalPlan===req.query.arrival)
      &&(!req.query.spendBand||g.spendBand===Number(req.query.spendBand))&&(!req.query.minCapacity||g.remainingCapacity>=Number(req.query.minCapacity))
      &&(!req.query.activity||g.plans?.[req.query.activity])&&(!req.query.vibe||g.vibe?.[req.query.vibe]>0)
      &&(req.query.preferredOnly!=='true'||g.preferred));
    if(req.query.sort==='capacity')filtered.sort((a,b)=>b.remainingCapacity-a.remainingCapacity||a.id.localeCompare(b.id));
    if(req.query.sort==='host')filtered.sort((a,b)=>a.hostName.localeCompare(b.hostName)||a.id.localeCompare(b.id));
    return res.json({groups:filtered.slice(offset,offset+limit),total:filtered.length,limit,offset});
  };
  router.get('/groups/discover/:concertId', requireUser, concertExists, (req, res,next) => {
    try{return page(req,res,repos.recommendations.individual(req.user.id,req.params.concertId));}catch(e){next(e);}
  });
  router.get('/me/seeker-request/:concertId', requireUser, concertExists, (req, res) => {
    repos.proposals.expire();
    const request = repos.groups.seeker(req.user.id, req.params.concertId);
    return send(res, request ? { ...request, user: undefined } : null, 'request');
  });
  router.post('/me/seeker-request/:concertId/reopen', requireUser, concertExists, (req, res) =>
    send(res, repos.groups.reopen(req.user.id, req.params.concertId), 'request'));
  router.get('/me/group-preferences/:concertId', requireUser, concertExists, (req, res) =>
    send(res, repos.groups.preferences(req.user.id, req.params.concertId), 'preferences'));
  router.put('/group-preferences/:partyId', requireUser, (req, res) =>
    send(res, repos.groups.addPreference(req.user.id, req.params.partyId), 'preference'));
  router.delete('/group-preferences/:partyId', requireUser, (req, res) =>
    send(res, repos.groups.removePreference(req.user.id, req.params.partyId), 'preference'));
  router.get('/me/hosted-groups', requireUser, (req, res) =>
    send(res, repos.groups.hosted(req.user.id), 'groups'));
  router.get('/group-connections/candidates/:concertId', requireUser, concertExists, (req, res) => {
    if (typeof req.query.fromPartyId !== 'string' || !req.query.fromPartyId) return res.status(400).json({ error: 'source_group_required' });
    try{return page(req,res,repos.recommendations.groups(req.user.id,req.params.concertId,req.query.fromPartyId));}
    catch(e){if(e.status)return res.status(e.status).json({error:e.message});throw e;}
  });
  router.get('/me/group-connections', requireUser, (req, res) =>
    send(res, repos.groups.connections(req.user.id), 'connections'));
  router.post('/group-connections', requireUser, (req, res) => {
    const { fromPartyId, toPartyId } = req.body ?? {};
    if (typeof fromPartyId !== 'string' || typeof toPartyId !== 'string') return res.status(400).json({ error: 'group_ids_required' });
    return send(res, repos.groups.invite(req.user.id, fromPartyId, toPartyId), 'connection', 201);
  });
  router.post('/group-connections/:id/respond', requireUser, (req, res) =>
    send(res, repos.groups.respond(req.user.id, req.params.id, req.body?.action), 'connection'));
  // Withdrawing is the sender's counterpart to responding, so it gets its own
  // verb rather than an action the respond route would have to refuse by host.
  router.delete('/group-connections/:id', requireUser, (req, res) =>
    send(res, repos.groups.cancel(req.user.id, req.params.id), 'connection'));
}
