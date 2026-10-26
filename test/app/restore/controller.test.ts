// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RestoreUI } from '../../../src/app/restore/controller';
import { Locale, localizePage } from '../../../src/i18n';
import { RestoreStatus } from '../../../src/restore/codes';
import { createSyntheticCapture } from '../../helpers/board-capture';
import { jsonBytes } from '../../../src/snapshot/encoding';
import { loadPage, installSdk, button } from '../../helpers/browser';
import { restorationFixture, restoreJournal } from '../../helpers/restore';
import { id, sourceBoard } from '../../helpers/snapshot';
import { LocalJournalStore } from '../../../src/restore/journal';

const downloads = vi.hoisted(() => ({ downloadJson: vi.fn(), downloadBlob: vi.fn() }));
vi.mock('../../../src/app/download', () => downloads);
beforeEach(() => loadPage('export'));
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
});

function setup(embedded = false, fixture = restorationFixture()) {
  const { frame, client } = installSdk();
  frame.getContext.mockReturnValue({ board: sourceBoard.id, locale: 'ru' });
  let locale = Locale.Russian;
  vi.stubGlobal('fetch', fixture.fetchImpl);
  const render = () => {
    localizePage(locale, document);
    ui.render();
  };
  const ui = new RestoreUI({
    document,
    getFrame: () => (embedded ? frame : null),
    getLocale: () => locale,
    exportBusy: () => false,
    changed: render,
  });
  render();
  return {
    ui,
    client,
    fixture,
    render,
    language: (value: Locale) => {
      locale = value;
      render();
    },
  };
}
function choose(file = new File([jsonBytes(createSyntheticCapture().snapshot)], 'export.json')) {
  const input = document.getElementById('restore-file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change'));
}
async function ready(ui: RestoreUI) {
  await vi.waitFor(() => expect(ui.model.busy).toBe(false));
}

test('standalone import previews a valid file, switches language, and never enables Trello writes', async () => {
  const { ui, fixture, language } = setup();
  button('restore-tab').click();
  choose();
  await ready(ui);
  expect(document.getElementById('export-panel')?.hidden).toBe(true);
  expect(document.getElementById('restore-source')?.textContent).toBe('Studio launch');
  (document.getElementById('restore-confirm') as HTMLInputElement).click();
  expect(button('restore-start').disabled).toBe(true);
  language(Locale.English);
  expect(document.getElementById('restore-status')?.textContent).toContain('destination board');
  button('export-tab').click();
  expect(document.getElementById('export-panel')?.hidden).toBe(false);
  expect(fixture.calls).toHaveLength(0);
  expect(
    () =>
      new RestoreUI({
        document: document.implementation.createHTMLDocument(),
        getFrame: () => null,
        getLocale: () => Locale.English,
        exportBusy: () => false,
        changed: () => {},
      }),
  ).toThrow('Missing restore control');
});

test('an explicit confirmation applies to the current board and offers the report', async () => {
  const { ui, client, fixture } = setup(true);
  button('restore-report').click();
  button('restore-start').click();
  choose();
  await ready(ui);
  expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
  (document.getElementById('restore-confirm') as HTMLInputElement).click();
  button('restore-start').click();
  await ready(ui);
  expect(client.authorize).toHaveBeenCalledWith({
    scopes: ['read:board:trello', 'write:board:trello'],
  });
  expect(ui.model.report?.status).toBe(RestoreStatus.Partial);
  expect(document.getElementById('restore-target')?.getAttribute('href')).toContain(
    'trello.com/b/',
  );
  button('restore-report').click();
  expect(downloads.downloadJson).toHaveBeenCalled();
});

test('an uncertain operation on another board disables applying the reviewed input', async () => {
  const journal = restoreJournal();
  journal.target = {
    id: id(777),
    name: 'Other synthetic board',
    workspaceId: journal.workspaceId,
    url: 'https://trello.com/b/OTHER001',
  };
  journal.sourceContextId = id(777);
  journal.status = RestoreStatus.Unknown;
  new LocalJournalStore(localStorage).save(journal);
  const { ui, fixture, client, language } = setup(true);
  choose();
  await ready(ui);
  expect(ui.model.plan).not.toBeNull();
  language(Locale.English);
  expect(document.getElementById('restore-status')?.textContent).toContain('unknown');
  (document.getElementById('restore-confirm') as HTMLInputElement).click();
  expect(button('restore-start').disabled).toBe(true);
  button('restore-start').click();
  expect(client.authorize).not.toHaveBeenCalled();
  expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
});

test('diagnostic reports and invalid files display a safe error without API calls', async () => {
  const { ui, fixture } = setup(true);
  choose(new File(['{"capture":{},"private":"do-not-render"}'], 'report.json'));
  await ready(ui);
  expect(ui.model.imported).toBeNull();
  expect(document.getElementById('restore-status')?.textContent).toContain('Файл');
  expect(document.body.textContent).not.toContain('do-not-render');
  expect(fixture.calls).toHaveLength(0);
});

test('missing authorization allows connection, and a failed consent request stays user-readable', async () => {
  const { ui, client } = setup(true);
  client.getAccessToken.mockResolvedValue(null);
  choose();
  await ready(ui);
  expect(ui.model.context).toBeNull();
  client.authorize.mockRejectedValueOnce(new Error('private-oauth-detail'));
  button('restore-connect').click();
  await ready(ui);
  expect(document.body.textContent).not.toContain('private-oauth-detail');
  client.getAccessToken.mockResolvedValue('synthetic-token');
  button('restore-connect').click();
  await ready(ui);
  expect(ui.model.context).not.toBeNull();
});

test('known write failure can continue the same local operation without duplicating content', async () => {
  let blocked = true;
  const fixture = restorationFixture((call) =>
    call.path === '/cards' && call.method === 'POST' && blocked
      ? new Response('', { status: 403 })
      : undefined,
  );
  const { ui } = setup(true, fixture);
  choose();
  await ready(ui);
  (document.getElementById('restore-confirm') as HTMLInputElement).click();
  button('restore-start').click();
  await ready(ui);
  expect(ui.model.report?.status).toBe(RestoreStatus.Failed);
  expect(button('restore-resume').hidden).toBe(false);
  blocked = false;
  button('restore-analyze').click();
  await ready(ui);
  (document.getElementById('restore-confirm') as HTMLInputElement).click();
  button('restore-resume').click();
  await ready(ui);
  expect(ui.model.report?.status).toBe(RestoreStatus.Partial);
  expect(
    fixture.calls.filter((call) => call.path === '/boards' && call.method === 'POST'),
  ).toHaveLength(0);
});

test('storage errors and cancellation cannot produce hidden background writes', async () => {
  const { ui, fixture } = setup(true);
  choose();
  await ready(ui);
  const blocked: Storage = {
    length: 0,
    clear: vi.fn(),
    key: () => null,
    removeItem: vi.fn(),
    getItem: () => null,
    setItem: () => {
      throw new Error('blocked');
    },
  };
  vi.spyOn(window, 'localStorage', 'get').mockReturnValue(blocked);
  (document.getElementById('restore-confirm') as HTMLInputElement).click();
  button('restore-start').click();
  await ready(ui);
  expect(ui.model.report).toBeNull();
  expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
  const file = new File([jsonBytes(createSyntheticCapture().snapshot)], 'export.json');
  const original = await file.arrayBuffer();
  let finish: ((value: ArrayBuffer) => void) | undefined;
  vi.spyOn(file, 'arrayBuffer').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  choose(file);
  expect(ui.busy).toBe(true);
  button('restore-cancel').click();
  finish?.(original);
  await ready(ui);
  expect(document.getElementById('restore-status')?.textContent).toContain('отменен');
});

test('conflict choices are mandatory, safe to display, localized, and invalidate confirmation', async () => {
  const snapshot = createSyntheticCapture().snapshot;
  const fixture = restorationFixture(undefined, snapshot);
  const card = snapshot.cards[0]!;
  fixture.records.get(`/cards/${card.id}`)!.name = '<img src=x onerror=alert(1)>';
  fixture.records.get(`/cards/${card.id}`)!.desc = 'Changed description';
  const { ui, language } = setup(true, fixture);
  choose(new File([jsonBytes(snapshot)], 'snapshot.json'));
  await ready(ui);
  const confirmation = document.getElementById('restore-confirm') as HTMLInputElement;
  confirmation.click();
  expect(ui.model.plan?.unresolved).toBe(2);
  expect(button('restore-start').disabled).toBe(true);
  expect(document.querySelector('#restore-conflicts img')).toBeNull();
  expect(document.getElementById('restore-conflicts')?.textContent).toContain('<img');
  language(Locale.English);
  expect(document.getElementById('restore-conflicts')?.textContent).toContain('Current board');
  const select = document.querySelector<HTMLSelectElement>('#restore-conflicts select')!;
  select.focus();
  select.value = 'keep-current';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(confirmation.checked).toBe(false);
  expect((document.activeElement as HTMLSelectElement).dataset.conflictKey).toBe(
    select.dataset.conflictKey,
  );
  button('restore-use-all').click();
  expect(ui.model.plan?.unresolved).toBe(0);
  expect(button('restore-start').disabled).toBe(true);
  button('restore-keep-all').click();
  expect(ui.model.plan?.actions).toHaveLength(0);
  confirmation.click();
  button('restore-start').click();
  await ready(ui);
  expect(ui.model.report?.status).toBe(RestoreStatus.Complete);
  expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
});

test('identity choices are explicit and do not get resolved by bulk value preferences', async () => {
  const snapshot = createSyntheticCapture().snapshot;
  const fixture = restorationFixture(undefined, snapshot);
  const original = snapshot.lists[0]!;
  const replacement = 'b'.repeat(24);
  fixture.records.delete(`/lists/${original.id}`);
  fixture.records.set(`/lists/${replacement}`, {
    id: replacement,
    name: original.name,
    closed: false,
    idBoard: sourceBoard.id,
    pos: 0,
  });
  for (const card of fixture.children('/cards'))
    if (card.idList === original.id) card.idList = replacement;
  const { ui } = setup(true, fixture);
  choose(new File([jsonBytes(snapshot)], 'snapshot.json'));
  await ready(ui);
  button('restore-use-all').click();
  expect(ui.model.plan?.unresolved).toBe(1);
  const select = document.querySelector<HTMLSelectElement>('#restore-conflicts select')!;
  expect([...select.options].map((option) => option.value)).toEqual([
    '',
    replacement,
    'create-separate',
    'skip-snapshot',
  ]);
  select.value = replacement;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(ui.model.plan?.unresolved).toBe(0);
  expect(ui.model.plan?.actions).toHaveLength(0);
});

test('board changes after review require a fresh comparison and new confirmation', async () => {
  const { ui, fixture } = setup(true);
  choose();
  await ready(ui);
  fixture.records.get(`/boards/${sourceBoard.id}`)!.desc = 'Changed after review';
  const confirmation = document.getElementById('restore-confirm') as HTMLInputElement;
  confirmation.click();
  button('restore-start').click();
  await ready(ui);
  expect(ui.model.plan).toBeNull();
  expect(document.getElementById('restore-status')?.textContent).toContain('изменилась');
  expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
  button('restore-analyze').click();
  await ready(ui);
  expect(confirmation.checked).toBe(false);
  expect(ui.model.plan?.unresolved).toBe(1);
});
