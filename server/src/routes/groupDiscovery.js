/** Group identity always comes from the existing authenticated session. */
export function registerGroupDiscoveryRoutes(router, { repos, requireUser }) {
  const send = (res, result, key, status = 200) => result?.error
    ? res.status(result.status ?? 400).json({ error: result.error })
    : res.status(status).json({ [key]: result });
  const concertExists = (req, res, next) => repos.concerts.findById(req.params.concertId)
    ? next() : res.status(404).json({ error: 'concert_not_found' });
  router.get('/groups/discover/:concertId', requireUser, concertExists, (req, res) =>
    send(res, repos.groups.discover(req.user.id, req.params.concertId), 'groups'));
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
    return send(res, repos.groups.connectionCandidates(req.user.id, req.params.concertId, req.query.fromPartyId), 'groups');
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
}
