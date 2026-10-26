// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadPage, installSdk } from '../helpers/browser';
import { translations } from '../../src/i18n';

beforeEach(() => {
  vi.resetModules();
  loadPage('connector');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('connector registers localized buttons and signs the modal through the SDK', async () => {
  const { sdk, frame, client } = installSdk();
  await import('../../src/trello/connector');
  const capabilities = sdk.initialize.mock.calls[0]?.[0];
  expect(capabilities).toBeDefined();
  if (!capabilities) throw new Error('Missing capabilities');
  const entry = capabilities['board-buttons'](frame)[0];
  expect(entry?.text).toBe(translations.ru.boardButton);
  expect(entry?.icon).toMatch(/^(https?:|data:image\/svg\+xml)/);
  await entry?.callback(frame);
  expect(frame.modal).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'http://localhost:3000/trello-exporter-importer/export.html?board=TEST0001&clientId=public-client',
      title: 'trello-exporter-importer',
      accentColor: '#1D2125',
    }),
  );
  expect(await capabilities['authorization-status'](frame)).toEqual({ authorized: true });
  client.getAccessToken.mockRejectedValueOnce(new Error('synthetic-private-sdk-error'));
  expect(await capabilities['authorization-status'](frame)).toEqual({ authorized: false });
});

test('missing public client prevents token lookup', async () => {
  loadPage('connector', 'board=TEST0001');
  const { sdk, frame, client } = installSdk();
  await import('../../src/trello/connector');
  const capabilities = sdk.initialize.mock.calls[0]?.[0];
  expect(await capabilities?.['authorization-status'](frame)).toEqual({ authorized: false });
  expect(client.getAccessToken).not.toHaveBeenCalled();
});

test('invalid runtime settings fail closed without leaking SDK errors', async () => {
  loadPage('connector', 'clientId=invalid%3Fclient');
  const { sdk } = installSdk();
  await import('../../src/trello/connector');
  expect(sdk.initialize).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('Loading');
});

test('a missing SDK leaves a readable connector status', async () => {
  await import('../../src/trello/connector');
  expect(document.getElementById('connector-status')?.textContent).toMatch(
    /unavailable|недоступен/,
  );
});
