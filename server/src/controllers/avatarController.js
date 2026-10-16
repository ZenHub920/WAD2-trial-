/**
 * Profile pictures.
 *
 * Optional everywhere: at registration, and afterwards. A user without one is
 * stored as NULL and drawn as a grey silhouette, which is a deliberate choice
 * rather than a placeholder to be nagged about.
 *
 * VALIDATION
 * Reuses `decodeTicketImage`, which inspects the actual bytes — PNG chunk
 * structure, JPEG markers, GIF and WebP headers — rather than trusting the
 * `data:image/...` label the client supplied. A file renamed to .png, or a
 * MIME type simply asserted in the data URI, is rejected. That matters here
 * because avatars are served back as static files to other users.
 *
 * The old file is removed only AFTER the new path is committed, so a failure
 * midway leaves the user with their previous picture rather than none.
 */

import { publicUser } from './publicUser.js';

export function createAvatarController(repos, images) {
  return {
    /** Set or replace the caller's picture. */
    set(req, res) {
      const image = req.body?.image;
      if (typeof image !== 'string' || !image) {
        return res.status(400).json({ error: 'image_required' });
      }

      let saved;
      try {
        saved = images.save(image);
      } catch (err) {
        if (err.message === 'invalid_image') {
          return res.status(400).json({ error: 'invalid_image' });
        }
        throw err;
      }

      const previous = repos.users.findById(req.user.id)?.avatar_path ?? null;
      repos.users.setAvatar(req.user.id, saved);
      // Only now is the old one orphaned, so an error above cannot have
      // deleted a picture the user still has.
      if (previous && previous !== saved) images.remove(previous);

      return res.json({ user: publicUser(repos.users.findById(req.user.id)) });
    },

    /** Remove it and fall back to the silhouette. */
    clear(req, res) {
      const previous = repos.users.findById(req.user.id)?.avatar_path ?? null;
      repos.users.setAvatar(req.user.id, null);
      if (previous) images.remove(previous);
      return res.json({ user: publicUser(repos.users.findById(req.user.id)) });
    },
  };
}
