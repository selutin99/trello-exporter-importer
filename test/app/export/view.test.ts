// @vitest-environment happy-dom
import { beforeEach, expect, test } from 'vitest';
import { loadPage } from '../../helpers/browser';
import { ExportView } from '../../../src/app/export/view';
import { ExportState } from '../../../src/app/export/types';
import { ExportSession } from '../../../src/app/export/session';
import { Locale, translations } from '../../../src/i18n';
import { ExportFormat, ExportStage, IssueCode } from '../../../src/snapshot/codes';
import { createSyntheticCapture } from '../../helpers/board-capture';

beforeEach(() => loadPage('export'));

test('every format preserves attachment links and the selected privacy language', () => {
  const view = new ExportView(document);
  const session = new ExportSession(() => {});
  for (const locale of Object.values(Locale)) {
    for (const format of Object.values(ExportFormat)) {
      session.selectFormat(format);
      view.render(locale, session.model, false, false);
      expect(document.querySelector('input[value="zip"]')).toBeNull();
      expect(document.getElementById('file-connect')).toBeNull();
      expect(document.body.textContent).toContain(translations[locale].exportAttachmentLinks);
      expect(view.element('privacy-link', HTMLAnchorElement).getAttribute('href')).toBe(
        `./privacy.html?lang=${locale}`,
      );
    }
  }
});

test('a missing control fails clearly and progress is accessible', () => {
  const view = new ExportView(document);
  expect(() => view.element('missing', HTMLButtonElement)).toThrow('Missing export control');
  const session = new ExportSession(() => {});
  view.render(
    Locale.Russian,
    {
      ...session.model,
      progress: { stage: ExportStage.Content, current: 1, total: 3 },
    },
    true,
    true,
  );
  expect(view.element('progress', HTMLProgressElement).value).toBe(1);
  expect(view.element('progress', HTMLProgressElement).max).toBe(3);
  expect(view.element('progress-label', HTMLElement).textContent).toContain('1 / 3');
});

test.each([0, 3])('a board with %i lists but no active cards cannot be exported', (lists) => {
  const view = new ExportView(document);
  const session = new ExportSession(() => {});
  for (const locale of Object.values(Locale)) {
    view.render(
      locale,
      {
        ...session.model,
        state: ExportState.Ready,
        board: { name: 'Empty synthetic board', lists, cards: 0 },
        result: null,
      },
      true,
      false,
    );
    expect(view.element('export', HTMLButtonElement).disabled).toBe(true);
    expect(view.element('status', HTMLElement).textContent).toBe(translations[locale].exportEmpty);
  }
});

test('all warning types are localized, and untrusted entity IDs remain plain text', () => {
  const view = new ExportView(document);
  const capture = createSyntheticCapture();
  capture.snapshot.issues = Object.values(IssueCode).map((code) => ({
    code,
    severity: 'warning',
    entityType: 'content',
    entityId: code === IssueCode.BoardChanged ? null : '<script>attack</script>',
    message: code,
  }));
  const session = new ExportSession(() => {});
  view.render(
    Locale.English,
    {
      ...session.model,
      state: ExportState.Partial,
      board: { name: capture.snapshot.board.name, lists: 3, cards: 6 },
      result: {
        blob: new Blob(['synthetic']),
        snapshot: capture.snapshot,
        filename: 'snapshot.json',
        format: ExportFormat.Json,
      },
    },
    false,
    false,
  );
  expect(view.element('warning-list', HTMLElement).children).toHaveLength(4);
  expect(document.querySelector('#warning-list script')).toBeNull();
});
