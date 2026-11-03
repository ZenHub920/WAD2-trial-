/**
 * Setlist endpoints: anyone may read one, only an operator may write one.
 *
 * The write is a whole-list replace rather than per-track edits. A setlist is
 * an ordered thing that changes as a unit — a song is inserted and everything
 * after it shifts — so sending the running order as it should now stand is
 * both simpler to reason about and impossible to leave half-applied.
 */

export function createSetlistController(repos) {
  return {
    /** Public. `setlist: null` means no operator has entered one. */
    get(req, res) {
      if (!repos.concerts.findById(req.params.id))
        return res.status(404).json({ error: 'concert_not_found' });
      res.json({ setlist: repos.setlists.get(req.params.id) });
    },

    /** Operator only; the route guard enforces that before this runs. */
    replace(req, res, next) {
      try {
        res.json({ setlist: repos.setlists.replace(req.user.id, req.params.id, req.body) });
      } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
      }
    },

    /** Operator only. Removes the list so the disc stops appearing. */
    clear(req, res, next) {
      try {
        if (!repos.concerts.findById(req.params.id))
          return res.status(404).json({ error: 'concert_not_found' });
        repos.setlists.clear(req.params.id);
        res.json({ setlist: null });
      } catch (error) {
        next(error);
      }
    },
  };
}
