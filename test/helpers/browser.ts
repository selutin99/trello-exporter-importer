import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { vi } from 'vitest';
import type { OAuthClient, PowerUpFrame, PowerUpSdk } from '../../src/trello/sdk';

export const board = {
  id: 'a'.repeat(24),
  shortLink: 'TEST0001',
  name: 'Synthetic board',
  closed: false,
};

export function loadPage(
  page: 'probe' | 'connector' | 'authorize' | 'export' | 'privacy',
  query = 'board=TEST0001&clientId=public-client',
): void {
  const html = readFileSync(new NodeURL(`../../src/pages/${page}.html`, import.meta.url), 'utf8');
  document.body.innerHTML = /<body>([\s\S]*?)<\/body>/.exec(html)?.[1] ?? '';
  window.history.replaceState(null, '', `/trello-exporter-importer/${page}.html?${query}`);
  window.localStorage.clear();
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
  vi.stubGlobal('TrelloPowerUp', undefined);
  vi.stubGlobal('opener', null);
  vi.stubGlobal('parent', window);
}

export function installSdk() {
  const attachmentClient = {
    getToken: vi.fn().mockResolvedValue('synthetic-file-token'),
    authorize: vi.fn().mockResolvedValue(undefined),
    clearToken: vi.fn().mockResolvedValue(undefined),
  };
  const client = {
    getAccessToken: vi.fn<OAuthClient['getAccessToken']>().mockResolvedValue('synthetic-token'),
    authorize: vi.fn<OAuthClient['authorize']>().mockResolvedValue(undefined),
    redirectUriCallback: vi.fn<OAuthClient['redirectUriCallback']>().mockResolvedValue(undefined),
  };
  const frame = {
    getContext: vi
      .fn<PowerUpFrame['getContext']>()
      .mockReturnValue({ board: board.id, locale: 'ru' }),
    getOAuth2ApiClient: vi.fn<PowerUpFrame['getOAuth2ApiClient']>().mockReturnValue(client),
    getRestApi: vi.fn().mockReturnValue(attachmentClient),
    render: vi.fn<PowerUpFrame['render']>().mockImplementation((callback) => callback()),
    modal: vi.fn<PowerUpFrame['modal']>().mockResolvedValue(undefined),
  };
  const sdk = {
    iframe: vi.fn<PowerUpSdk['iframe']>().mockReturnValue(frame),
    initialize: vi.fn<PowerUpSdk['initialize']>(),
  };
  vi.stubGlobal('TrelloPowerUp', sdk);
  return { client, frame, sdk, attachmentClient };
}

export function button(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${id}`);
  return element;
}
