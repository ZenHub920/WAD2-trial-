import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import ConfirmDialog from '../../client/src/components/ConfirmDialog.vue';

async function openDialog() {
  const opener = document.createElement('button');
  opener.textContent = 'Change plan';
  document.body.append(opener);
  opener.focus();
  const wrapper = mount(ConfirmDialog, {
    attachTo: document.body,
    props: { open: true, title: 'Change this plan?', confirmLabel: 'Change plan', cancelLabel: 'Keep plan' },
  });
  await nextTick();
  return { wrapper, opener, dialog: document.querySelector('[role="dialog"]') };
}

function press(target, key, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('Confirmation keyboard interaction', () => {
  it('can initially focus the safe cancel action without changing other confirmations', async () => {
    mount(ConfirmDialog, { attachTo: document.body, props: { open: true, title: 'Leave draft?', initialFocus: 'cancel', cancelLabel: 'Keep editing' } });
    await nextTick();
    expect(document.activeElement.textContent.trim()).toBe('Keep editing');
  });
  it('focuses the existing confirm action and wraps Tab in both directions', async () => {
    const { dialog } = await openDialog();
    const [cancel, confirm] = dialog.querySelectorAll('button');
    expect(document.activeElement).toBe(confirm);
    expect(press(confirm, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    expect(press(cancel, 'Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
  });

  it('emits the existing confirm/cancel actions and restores the opener on close', async () => {
    const { wrapper, opener, dialog } = await openDialog();
    dialog.querySelectorAll('button')[1].click();
    expect(wrapper.emitted('confirm')).toHaveLength(1);
    press(document.activeElement, 'Escape');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    await wrapper.setProps({ open: false });
    await nextTick();
    expect(document.activeElement).toBe(opener);
  });

  it('retains focus and blocks cancellation while the existing action is busy', async () => {
    const { wrapper, dialog } = await openDialog();
    await wrapper.setProps({ busy: true });
    await nextTick();
    expect(document.activeElement).toBe(dialog);
    expect([...dialog.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
    expect(press(dialog, 'Tab').defaultPrevented).toBe(true);
    press(dialog, 'Escape');
    dialog.click();
    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('returns focus when removed, without stealing focus moved elsewhere on close', async () => {
    const { wrapper, opener } = await openDialog();
    wrapper.unmount();
    expect(document.activeElement).toBe(opener);
    const second = await openDialog();
    opener.focus();
    await second.wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(opener);
  });
});
