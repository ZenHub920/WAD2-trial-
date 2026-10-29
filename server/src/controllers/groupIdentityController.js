/**
 * Group name and picture, set by the group's host.
 *
 * Pictures reuse the profile-picture store: the bytes are validated the same
 * way, and the file is served from /api/avatars. As with profile pictures the
 * old file is removed only after the new one is committed.
 */

import { groupName } from './concertController.js';
import { groupImageUrl } from '../presentation/groupIdentity.js';

export { groupImageUrl };

export function createGroupIdentityController(repos, images) {
  /** The party, or null after sending the error response. */
  const ownedGroup = (req, res) => {
    const party = repos.parties.findById(req.params.id);
    if (!party) { res.status(404).json({ error: 'group_not_found' }); return null; }
    if (party.host_user_id !== req.user.id) { res.status(403).json({ error: 'host_required' }); return null; }
    if (party.status === 'cancelled') { res.status(409).json({ error: 'group_unavailable' }); return null; }
    return party;
  };
  const identity = (id) => {
    const party = repos.parties.findById(id);
    return { id, name: party.name, imageUrl: groupImageUrl(party.image_path) };
  };

  return {
    setName(req, res) {
      const party = ownedGroup(req, res);
      if (!party) return;
      const name = groupName(req.body?.name);
      if (name === undefined) return res.status(400).json({ error: 'invalid_group_name' });
      repos.parties.setName(party.id, name);
      return res.json({ group: identity(party.id) });
    },

    setImage(req, res) {
      const party = ownedGroup(req, res);
      if (!party) return;
      const image = req.body?.image;
      if (typeof image !== 'string' || !image) return res.status(400).json({ error: 'image_required' });
      let saved;
      try {
        saved = images.save(image);
      } catch (err) {
        if (err.message === 'invalid_image') return res.status(400).json({ error: 'invalid_image' });
        throw err;
      }
      repos.parties.setImage(party.id, saved);
      if (party.image_path && party.image_path !== saved) images.remove(party.image_path);
      return res.json({ group: identity(party.id) });
    },

    clearImage(req, res) {
      const party = ownedGroup(req, res);
      if (!party) return;
      repos.parties.setImage(party.id, null);
      if (party.image_path) images.remove(party.image_path);
      return res.json({ group: identity(party.id) });
    },
  };
}
