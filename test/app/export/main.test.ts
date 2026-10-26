// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadPage, installSdk, button } from '../../helpers/browser';
import { fixtureResponses, id, sourceBoard } from '../../helpers/snapshot';

const downloads = vi.hoisted(() => ({ downloadBlob: vi.fn(), downloadJson: vi.fn() }));
vi.mock('../../../src/app/download', () => downloads);

beforeEach(() => {
  vi.resetModules();
  loadPage('export');
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
});
const start = () => import('../../../src/app/export/main');

test('standalone links cannot activate sample content or initialize the SDK', async () => {
  loadPage('export', 'demo=1');
  const { sdk } = installSdk();
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  await start();
  expect(document.getElementById('board-name')?.textContent).toBe('—');
  expect(document.getElementById('standalone')?.hidden).toBe(false);
  expect(document.getElementById('demo')).toBeNull();
  expect(document.getElementById('demo-notice')).toBeNull();
  expect(button('export').disabled).toBe(true);
  button('connect').click();
  button('refresh').click();
  button('save').click();
  button('report').click();
  expect(sdk.iframe).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
const change = (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('change'));
};

function live(responses = fixtureResponses) {
  const sdk = installSdk();
  sdk.frame.getContext.mockReturnValue({ board: sourceBoard.id, locale: 'ru' });
  vi.stubGlobal('parent', {});
  const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return Promise.resolve(new Response(JSON.stringify(responses[url.pathname])));
  });
  vi.stubGlobal('fetch', fetcher);
  return { ...sdk, fetcher };
}

test('an embedded session downloads JSON and preserves language preferences', async () => {
  const { fetcher } = live();
  await start();
  await vi.waitFor(() => expect(button('export').disabled).toBe(false));
  change('input[value="json"]', 'json');
  button('export').click();
  await vi.waitFor(() => expect(document.getElementById('result')?.hidden).toBe(false));
  button('save').click();
  button('report').click();
  expect(downloads.downloadBlob.mock.calls.at(-1)?.[1]).toMatch(/\.json$/);
  expect(downloads.downloadJson).toHaveBeenCalled();
  expect(downloads.downloadBlob.mock.calls.at(-1)?.[0]).toBeInstanceOf(Blob);
  change('#language', 'en');
  expect(document.documentElement.lang).toBe('en');
  expect(document.body.textContent).toContain('Export your board');
  expect(localStorage.getItem('exporter-locale')).toBe('en');
  expect(fetcher.mock.calls.every((call) => (call[1]?.method ?? 'GET') === 'GET')).toBe(true);
});

test('embedded workflow reads only the selected board, preserves attachment links, reconnects and refreshes', async () => {
  const { frame, client, fetcher } = live();
  await start();
  await vi.waitFor(() => expect(button('export').disabled).toBe(false));
  expect(document.getElementById('board-name')?.textContent).toBe(sourceBoard.name);
  button('export').click();
  await vi.waitFor(() => expect(document.getElementById('result')?.hidden).toBe(false));
  expect(document.getElementById('warning-list')?.children).toHaveLength(0);
  button('save').click();
  expect(downloads.downloadBlob.mock.calls.at(-1)?.[1]).toMatch(/\.json$/);
  button('refresh').click();
  await vi.waitFor(() => expect(button('export').disabled).toBe(false));
  button('connect').click();
  await vi.waitFor(() => expect(client.authorize).toHaveBeenCalled());
  await vi.waitFor(() => expect(button('export').disabled).toBe(false));
  frame.render.mock.calls[0]?.[0]();
  expect(fetcher.mock.calls.every((call) => (call[1]?.method ?? 'GET') === 'GET')).toBe(true);
});

test('authentication errors allow retry, and authorization errors remain user-readable', async () => {
  const { client } = live();
  client.getAccessToken.mockResolvedValue(null);
  await start();
  await vi.waitFor(() => expect(button('connect').disabled).toBe(false));
  client.authorize.mockRejectedValueOnce(new Error('private authorization detail'));
  button('connect').click();
  await vi.waitFor(() =>
    expect(document.getElementById('connection-status')?.textContent).toContain('Не удалось'),
  );
  expect(document.body.textContent).not.toContain('private authorization detail');
});

test('partial exports list warnings without interpreting source names as HTML', async () => {
  live({
    ...fixtureResponses,
    [`/1/cards/${id(3)}/attachments`]: [
      {
        id: id(4),
        name: '<img src=x onerror=alert(1)>',
        isUpload: false,
        url: 'javascript:alert(1)',
        mimeType: null,
        bytes: 0,
        pos: 1,
      },
    ],
  });
  await start();
  await vi.waitFor(() => expect(button('export').disabled).toBe(false));
  button('export').click();
  await vi.waitFor(() => expect(document.getElementById('warnings')?.hidden).toBe(false));
  expect(document.getElementById('result-title')?.textContent).toContain('предупреждениями');
});

test('unavailable preference storage does not prevent language changes or cancellation', async () => {
  live();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await start();
  await vi.waitFor(() => expect(button('export').disabled).toBe(false));
  change('#language', 'ru');
  expect(document.documentElement.lang).toBe('ru');
  button('export').click();
  button('cancel').click();
  await vi.waitFor(() =>
    expect(document.getElementById('status')?.textContent).toContain('отменен'),
  );
});

test('an explicit language preference survives the SDK locale and invalid config fails closed', async () => {
  localStorage.setItem('exporter-locale', 'en');
  live();
  await start();
  expect(document.documentElement.lang).toBe('en');
  await vi.waitFor(() => expect(button('export').disabled).toBe(false));
  vi.resetModules();
  loadPage('export', '');
  live();
  await start();
  expect(button('connect').disabled).toBe(true);
});

test('an unavailable SDK frame does not expose API controls', async () => {
  const { sdk } = live();
  sdk.iframe.mockImplementation(() => {
    throw new Error('sdk');
  });
  await start();
  expect(button('connect').disabled).toBe(true);
});

test('JSON export uses only board OAuth even when an old connector URL contains a file API key', async () => {
  loadPage('export', 'clientId=public-client&appKey=00000000000000000000000000000000');
  const { sdk, fetcher } = live();
  await start();
  await vi.waitFor(() => expect(button('export').disabled).toBe(false));
  expect(sdk.iframe).toHaveBeenCalledWith({
    clientId: 'public-client',
    redirectUri:
      'http://localhost:3000/trello-exporter-importer/authorize.html?clientId=public-client',
  });
  expect(document.querySelectorAll('input[name="format"]')).toHaveLength(5);
  expect(document.querySelector('input[value="zip"]')).toBeNull();
  expect(document.getElementById('file-connect')).toBeNull();
  button('export').click();
  await vi.waitFor(() => expect(document.getElementById('result')?.hidden).toBe(false));
  for (const [input, init] of fetcher.mock.calls) {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    expect(url.origin).toBe('https://api.trello.com');
    expect(url.pathname).not.toContain('/download/');
    expect(url.searchParams.has('key') || url.searchParams.has('token')).toBe(false);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-token');
  }
});
