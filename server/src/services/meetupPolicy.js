// Membership is resolved by the repository. These rules only receive trusted
// current host/participant identities and never read client-supplied role flags.
export function requiredMeetupApprovers(scope, groupHosts = [], participants = []) {
  return [...new Set(scope.kaki_conversation_id ? participants : groupHosts)];
}

export function meetupCapabilities(status, requiredApprovers, user) {
  const isOrganizer = requiredApprovers.includes(user), planning = status === 'planning';
  return {
    isOrganizer, canCreate: isOrganizer, canContribute: planning,
    canPropose: isOrganizer && planning, canApprove: isOrganizer && status === 'proposed',
    canReopen: isOrganizer && ['proposed', 'confirmed'].includes(status),
    canCancel: isOrganizer && status !== 'cancelled', canDiscuss: status !== 'cancelled',
  };
}

export function meetupActionError(action, status, isOrganizer) {
  if (['create', 'propose', 'reopen', 'cancel', 'approve'].includes(action) && !isOrganizer)
    return { code: action === 'approve' ? 'meetup_approver_required' : 'meetup_organizer_required', status: 403 };
  if (action !== 'create' && status === 'cancelled') return { code: 'meetup_cancelled', status: 409 };
  if (['contribute', 'propose'].includes(action) && status !== 'planning')
    return { code: 'meetup_reopen_required', status: 409 };
  if (action === 'reopen' && !['proposed', 'confirmed'].includes(status))
    return { code: 'meetup_not_proposed', status: 409 };
  if (action === 'approve' && status !== 'proposed') return { code: 'stale_meetup_version', status: 409 };
  return null;
}
