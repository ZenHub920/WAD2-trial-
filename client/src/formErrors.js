/**
 * Inline form errors, site-wide.
 *
 * Browsers report a failed `required` / `min` / `type="email"` check with their
 * own pop-up bubble, which cannot be styled. This listens for those checks on
 * every form, stops the bubble, and writes a short red message under the field
 * instead (marking the field aria-invalid and linking the message to it). The
 * message goes away as soon as the value becomes valid. Forms keep using plain
 * HTML attributes; nothing per form needs to change.
 */

let ids = 0;
let focusQueued = false;

function friendlyMessage(field) {
  const v = field.validity;
  // Pick-from-a-list fields (including SearchSelect dropdowns) say "choose".
  const choosing = field.tagName === 'SELECT' || Boolean(field.closest('.suggest--select')) || field.type === 'checkbox' || field.type === 'radio';
  if (v.valueMissing) return choosing ? 'Please choose an option.' : 'Please fill this in.';
  if (v.typeMismatch && field.type === 'email') return 'Enter a valid email address.';
  if (v.typeMismatch && field.type === 'url') return 'Enter a full web address, starting with https://.';
  if (v.badInput) return field.type === 'number' ? 'Enter a number.' : 'Enter a valid value.';
  if (v.rangeUnderflow) return `Must be ${field.min} or more.`;
  if (v.rangeOverflow) return `Must be ${field.max} or less.`;
  if (v.stepMismatch) return field.step && Number(field.step) < 1 ? `Use at most ${String(field.step).split('.')[1]?.length ?? 0} decimal places.` : 'Enter a whole number.';
  if (v.tooShort) return `Use at least ${field.minLength} characters.`;
  if (v.tooLong) return `Use at most ${field.maxLength} characters.`;
  if (v.patternMismatch) return field.title || 'Use the format shown.';
  return field.validationMessage;
}

// Where the message goes: after the field, or after a wrapper that belongs to it
// (our dropdowns wrap their input; checkboxes put the message after their label).
function anchorFor(field) {
  if (field.type === 'checkbox' || field.type === 'radio') return field.closest('label') ?? field;
  return field.closest('.suggest') ?? field;
}

function messageFor(field) {
  const id = field.dataset.errorId;
  return id ? document.getElementById(id) : null;
}

function show(field) {
  let message = messageFor(field);
  if (!message) {
    message = document.createElement('p');
    message.className = 'field-error';
    message.id = `field-error-${++ids}`;
    field.dataset.errorId = message.id;
    anchorFor(field).insertAdjacentElement('afterend', message);
    const described = field.getAttribute('aria-describedby');
    field.setAttribute('aria-describedby', described ? `${described} ${message.id}` : message.id);
  }
  message.textContent = friendlyMessage(field);
  field.setAttribute('aria-invalid', 'true');
  field.classList.add('field--invalid');
}

function clear(field) {
  const message = messageFor(field);
  if (!message) return;
  message.remove();
  delete field.dataset.errorId;
  const rest = (field.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== message.id);
  if (rest.length) field.setAttribute('aria-describedby', rest.join(' '));
  else field.removeAttribute('aria-describedby');
  field.removeAttribute('aria-invalid');
  field.classList.remove('field--invalid');
}

function onInvalid(event) {
  const field = event.target;
  if (!(field instanceof HTMLElement) || !field.form) return;
  event.preventDefault();
  show(field);
  // The bubble used to point at the first problem; take people there instead.
  if (!focusQueued) {
    focusQueued = true;
    setTimeout(() => {
      focusQueued = false;
      const first = field.form?.querySelector('.field--invalid');
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      first?.focus({ preventScroll: true });
    });
  }
}

function onEdit(event) {
  const field = event.target;
  if (!(field instanceof HTMLElement) || !field.dataset?.errorId) return;
  if (field.validity.valid) clear(field);
  else messageFor(field).textContent = friendlyMessage(field);
}

export function installFormErrors(root = document) {
  // Capture phase: `invalid` does not bubble.
  root.addEventListener('invalid', onInvalid, true);
  root.addEventListener('input', onEdit, true);
  root.addEventListener('change', onEdit, true);
}
