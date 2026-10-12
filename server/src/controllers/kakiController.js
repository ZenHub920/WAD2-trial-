import { publicUser } from './publicUser.js';

const publicPerson = (person) => ({ ...person, user: publicUser(person.user) });

export function createKakiController(repos) {
  return {
    pool(req, res) {
      const { concerts, people } = repos.kaki.pool(req.user.id);
      res.json({ concerts, people: people.map(publicPerson) });
    },
    decisions(req, res) {
      const people = repos.kaki.people(req.user.id);
      res.json({ decisions: repos.kaki.decisions(req.user.id, people) });
    },
    matches(req, res) {
      const people = repos.kaki.people(req.user.id);
      const decisions = repos.kaki.decisions(req.user.id, people);
      res.json({ matches: people.filter((person) => decisions[person.id]?.mutual).map(publicPerson) });
    },
    setDecision(req, res) {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || !['like', 'skip'].includes(req.body.decision)) {
        return res.status(400).json({ error: 'invalid_decision' });
      }
      const decision = repos.kaki.setDecision(req.user.id, req.params.concertId,
        req.params.targetUserId, req.body.decision);
      if (!decision) return res.status(404).json({ error: 'not_eligible' });
      res.json({ decision });
    },
    deleteDecision(req, res) {
      if (!repos.kaki.deleteDecision(req.user.id, req.params.concertId, req.params.targetUserId)) {
        return res.status(404).json({ error: 'not_eligible' });
      }
      res.status(204).end();
    },
  };
}
