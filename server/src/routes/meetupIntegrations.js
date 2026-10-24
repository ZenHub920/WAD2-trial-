export function registerMeetupIntegrationRoutes(router, { integrations }) {
  const route = (path, key, fn) => router.get(path, async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required' });
    res.set('Cache-Control', 'private, no-store');
    try { res.json({ [key]: await fn(req) }); }
    catch (e) { if (e.status) res.status(e.status).json({ error: e.message }); else next(e); }
  });
  route('/meetups/:id/locations', 'result', (r) => integrations.locations(r.user.id, r.params.id, r.query.q));
  route('/meetups/:id/travel-suggestions', 'recommendations', (r) => {
    if (r.query.shelteredOnly !== undefined && !['true', 'false'].includes(r.query.shelteredOnly))
      return Promise.reject(Object.assign(new Error('invalid_travel_options'), { status: 400 }));
    return integrations.suggestions(r.user.id, r.params.id, { shelteredOnly: r.query.shelteredOnly === 'true' });
  });
  route('/meetups/:id/transport', 'transport', (r) => integrations.transport(r.user.id, r.params.id, r.query));
  route('/meetups/:id/environment', 'environment', (r) => integrations.environment(r.user.id, r.params.id));
}
