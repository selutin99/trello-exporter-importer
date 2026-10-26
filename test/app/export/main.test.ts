// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadPage, installSdk, button } from '../../helpers/browser';
import { fixtureResponses, id, sourceBoard } from '../../helpers/snapshot';

const downloads = vi.hoisted(() => ({ downloadBlob: vi.fn(), downloadJson: vi.fn() }));
vi.mock('../../../src/app/download', () => downloads);

beforeEach(() => {
  vi.resetModules();
  loadPage('export', 'clientId=public-client&appKey=00000000000000000000000000000000');
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

test.each([
  '#token=synthetic-callback-token',
  '#%7B%22context%22%3A%7B%7D%7D#token=synthetic-callback-token',
  '#%7B%22context%22%3A%7B%7D%7D&token=synthetic-callback-token',
])(
  'a file-consent popup initializes only the SDK callback without reading board data: %s',
  async (fragment) => {
    const { sdk } = installSdk();
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('opener', {});
    window.history.replaceState(null, '', `${window.location.href}${fragment}`);
    await start();
    expect(sdk.iframe).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        appKey: '00000000000000000000000000000000',
        appName: 'trello-exporter-importer',
      }),
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('synthetic-callback-token');
    expect(localStorage.getItem('trello_token')).toBeNull();
  },
);

test.each(['missing-key', 'missing-sdk', 'sdk-error', 'ordinary-link'])(
  'file callback fails closed without exposing its fragment: %s',
  async (condition) => {
    if (condition === 'missing-key') loadPage('export', 'clientId=public-client');
    const { sdk } = installSdk();
    vi.stubGlobal('opener', {});
    if (condition !== 'ordinary-link')
      window.history.replaceState(
        null,
        '',
        `${window.location.href}#token=synthetic-callback-token`,
      );
    if (condition === 'missing-sdk') vi.stubGlobal('TrelloPowerUp', undefined);
    if (condition === 'sdk-error')
      sdk.iframe.mockImplementation(() => {
        throw new Error('private-sdk-detail');
      });
    await start();
    expect(button('export').disabled).toBe(true);
    expect(document.body.textContent).not.toContain('synthetic-callback-token');
    expect(document.body.textContent).not.toContain('private-sdk-detail');
    if (condition !== 'sdk-error') expect(sdk.iframe).not.toHaveBeenCalled();
  },
);
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
    if (url.pathname.includes('/download/')) return Promise.resolve(new Response('demo'));
    return Promise.resolve(new Response(JSON.stringify(responses[url.pathname])));
  });
  vi.stubGlobal('fetch', fetcher);
  return { ...sdk, fetcher };
}

test('an embedded session downloads JSON and ZIP and preserves language preferences', async () => {
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
  change('input[value="zip"]', 'zip');
  button('export').click();
  await vi.waitFor(() => expect(button('save').textContent).toContain('ZIP'));
  button('save').click();
  expect(downloads.downloadBlob.mock.calls.at(-1)?.[0]).toBeInstanceOf(Blob);
  change('#language', 'en');
  expect(document.documentElement.lang).toBe('en');
  expect(document.body.textContent).toContain('Export your board');
  expect(localStorage.getItem('exporter-locale')).toBe('en');
  expect(fetcher.mock.calls.every((call) => (call[1]?.method ?? 'GET') === 'GET')).toBe(true);
});

test('embedded workflow reads only the selected board, packages files, reconnects and refreshes', async () => {
  const { frame, client, fetcher } = live();
  await start();
  await vi.waitFor(() => expect(button('export').disabled).toBe(false));
  expect(document.getElementById('board-name')?.textContent).toBe(sourceBoard.name);
  button('export').click();
  await vi.waitFor(() => expect(document.getElementById('result')?.hidden).toBe(false));
  expect(document.getElementById('warning-list')?.children).toHaveLength(0);
  button('save').click();
  expect(downloads.downloadBlob.mock.calls.at(-1)?.[1]).toMatch(/\.zip$/);
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

test('ZIP waits for explicit file consent, while JSON remains usable after denial', async () => {
  const { attachmentClient, fetcher } = live();
  attachmentClient.getToken.mockResolvedValue(null);
  await start();
  await vi.waitFor(() =>
    expect(document.getElementById('board-name')?.textContent).toBe(sourceBoard.name),
  );
  expect(button('export').disabled).toBe(true);
  expect(attachmentClient.authorize).not.toHaveBeenCalled();
  attachmentClient.authorize.mockRejectedValueOnce(new Error('private-file-consent'));
  button('file-connect').click();
  await vi.waitFor(() =>
    expect(document.getElementById('file-access-status')?.textContent).toContain('не подключен'),
  );
  expect(document.body.textContent).not.toContain('private-file-consent');
  change('input[value="json"]', 'json');
  expect(button('export').disabled).toBe(false);
  expect(document.getElementById('file-access')?.hidden).toBe(true);
  change('input[value="zip"]', 'zip');
  attachmentClient.getToken.mockResolvedValue('synthetic-file-token');
  button('file-connect').click();
  await vi.waitFor(() => expect(button('export').disabled).toBe(false));
  button('export').click();
  await vi.waitFor(() => expect(document.getElementById('result')?.hidden).toBe(false));
  const files = fetcher.mock.calls.filter(([url]) =>
    (url instanceof Request ? url.url : url.toString()).includes('/download/'),
  );
  expect(files.length).toBeGreaterThan(0);
  expect(
    files.every(([, init]) =>
      String(new Headers(init?.headers).get('Authorization')).startsWith('OAuth '),
    ),
  ).toBe(true);
});
