/** Account recovery endpoints and operator-only evidence/review. */
export function registerAccountSecurityRoutes(router, { security, sessions } = {}) {
  const authenticated = (req, res, next) => req.user ? next()
    : res.status(401).json({ error: 'authentication_required' });
  const operator = (req, res, next) => !req.user
    ? res.status(401).json({ error: 'authentication_required' })
    : req.user.is_operator ? next() : res.status(403).json({ error: 'operator_required' });
  const route = (handler) => (req, res, next) => {
    try { handler(req, res); } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
  const accepted = { message: 'If this account can receive email, a link will arrive shortly.' };

  router.post('/auth/password-reset/request', route((req, res) => {
    security.requestReset(req.body?.email);
    res.status(202).json(accepted);
  }));
  router.post('/auth/password-reset/confirm', route((req, res) => {
    security.confirmReset(req.body?.token, req.body?.password);
    sessions.end(req, res);
    res.json({ changed: true, signInRequired: true });
  }));
  router.post('/auth/email-verification/request', authenticated, route((req, res) => {
    security.requestVerification(req.user.id);
    res.status(202).json(accepted);
  }));
  router.post('/auth/email-verification/confirm', route((req, res) => {
    security.confirmVerification(req.body?.token);
    res.json({ emailVerified: true });
  }));
  router.get('/auth/security', authenticated, route((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(security.status(req.user.id));
  }));
  router.post('/auth/password/change', authenticated, route((req, res) => {
    security.changePassword(req.user.id, req.body?.currentPassword, req.body?.password);
    sessions.end(req, res);
    res.json({ changed: true, signInRequired: true });
  }));
  router.delete('/auth/sessions', authenticated, route((req, res) => {
    const revoked = security.revokeSessions(req.user.id);
    sessions.end(req, res);
    res.json({ revoked, signInRequired: true });
  }));

  router.get('/operator/reports', operator, route((req, res) => {
    const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : Number(req.query.before);
    const limit = req.query.limit === undefined ? 30 : Number(req.query.limit);
    if (!Number.isSafeInteger(before) || before < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      return res.status(400).json({ error: 'invalid_pagination' });
    res.set('Cache-Control', 'no-store');
    res.json(security.repo.reports({ status: req.query.status ?? 'open', before, limit }));
  }));
  router.get('/operator/reports/:id', operator, route((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(security.repo.report(req.params.id));
  }));
  router.post('/operator/reports/:id/resolve', operator, route((req, res) => {
    const { report } = security.repo.report(req.params.id);
    const action = security.repo.moderate({ operatorId: req.user.id, userId: report.reported_user_id,
      reportId: report.id, action: req.body?.action, note: req.body?.note });
    res.json({ action });
  }));
  router.post('/operator/users/:id/unsuspend', operator, route((req, res) => {
    const action = security.repo.moderate({ operatorId: req.user.id, userId: req.params.id,
      action: 'unsuspend', note: req.body?.note });
    res.json({ action });
  }));
}
