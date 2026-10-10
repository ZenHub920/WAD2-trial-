const SECTIONS = ['pit', 'ga_standing', 'lower_bowl', 'upper_bowl', 'seated_any'];
const ARRIVALS = ['early_queue', 'mid', 'doors'];

export function createParticipationController(repos) {
  return {
    mine(req, res) {
      res.json({ concerts: repos.participation.mine(req.user.id) });
    },
    get(req, res) {
      if (!repos.concerts.findById(req.params.id)) return res.status(404).json({ error: 'concert_not_found' });
      res.json({ participation: repos.participation.find(req.user.id, req.params.id) });
    },
    join(req, res) {
      if (!repos.concerts.findById(req.params.id)) return res.status(404).json({ error: 'concert_not_found' });
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some((key) => !['sectionPref', 'arrivalPref'].includes(key))
        || !SECTIONS.includes(body.sectionPref) || !ARRIVALS.includes(body.arrivalPref)) {
        return res.status(400).json({ error: 'invalid_participation' });
      }
      res.json({ participation: repos.participation.join(req.user.id, req.params.id,
        body.sectionPref, body.arrivalPref) });
    },
    leave(req, res) {
      if (!repos.concerts.findById(req.params.id)) return res.status(404).json({ error: 'concert_not_found' });
      repos.participation.leave(req.user.id, req.params.id);
      res.status(204).end();
    },
  };
}
