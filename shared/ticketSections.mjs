// The seating sections a ticket listing can use. Shared so the listing forms
// offer exactly what the server accepts.
export const TICKET_SECTIONS = Object.freeze(['Cat 1', 'Cat 2', 'Cat 3', 'Cat 4', 'Cat 5', 'Cat 6', 'VIP', 'Pen A', 'Pen B', 'Standing']);

export function isTicketSection(value) {
  return typeof value === 'string' && TICKET_SECTIONS.includes(value.trim());
}
