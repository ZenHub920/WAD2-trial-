import { test, expect } from '../support/playwright.mjs';
import { fixture, person, api } from './support.js';

test('publication setting has its own explicit save, unsaved navigation is protected and cancellation requires confirmation', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA');
  const path = `/groups/${data.parties.a}/members`;
  const errors = []; host.page.on('pageerror', error => errors.push(error.message));
  try {
    await host.page.goto(path);
    await host.page.getByText('Group settings', { exact: true }).click();
    const open = host.page.getByLabel('Open to meeting other groups', { exact: true });
    await expect(open).toBeChecked();
    await open.uncheck();
    await expect(host.page.getByText('No unsaved changes.', { exact: true })).toHaveCount(0);
    await expect(host.page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await expect(host.page.getByRole('button', { name: 'Save publication settings', exact: true })).toBeEnabled();
    expect((await api(host.context, `/groups/${data.parties.a}/membership`)).group.settings.connect_open).toBe(1);
    await host.page.getByRole('link', { name: 'Concerts', exact: true }).first().click();
    const leave = host.page.getByRole('dialog', { name: 'Leave with unsaved group settings?', exact: true });
    await expect(leave.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(host.page).toHaveURL(new RegExp(path)); await expect(open).not.toBeChecked();
    await host.page.getByRole('button', { name: 'Save publication settings', exact: true }).click();
    await expect(host.page.getByText('Publication settings saved.', { exact: true })).toBeVisible();
    expect((await api(host.context, `/groups/${data.parties.a}/membership`)).group.settings.connect_open).toBe(0);
    await host.page.reload(); await expect(open).not.toBeChecked();
    await host.page.getByRole('button', { name: 'Cancel group', exact: true }).click();
    const cancel = host.page.getByRole('dialog', { name: 'Cancel this group?', exact: true });
    await expect(cancel).toContainText('cannot be undone');
    expect((await api(host.context, `/groups/${data.parties.a}/membership`)).group.status).not.toBe('cancelled');
    await cancel.getByRole('button', { name: 'Keep group', exact: true }).click();
    expect((await api(host.context, `/groups/${data.parties.a}/membership`)).group.status).not.toBe('cancelled');
    expect(errors).toEqual([]);
  } finally { await host.context.close(); }
});
