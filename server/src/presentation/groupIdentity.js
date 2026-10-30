/** Group pictures use the same validated avatar store as profile pictures. */
export const groupImageUrl = (path) => (path ? `/api/avatars/${path}` : null);
