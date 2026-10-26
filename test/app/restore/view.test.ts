// @vitest-environment happy-dom
import { beforeEach, expect, test } from 'vitest';
import { RestoreView } from '../../../src/app/restore/view';
import { RestoreMessage } from '../../../src/app/restore/types';
import type { RestoreModel } from '../../../src/app/restore/types';
import { Locale, localizePage, translations } from '../../../src/i18n';
import { buildMergePlan } from '../../../src/restore/merge/planner';
import { createSyntheticCapture } from '../../helpers/board-capture';
import { loadPage } from '../../helpers/browser';

beforeEach(() => loadPage('export'));

function preview() {
  return {
    imported: {
      snapshot: createSyntheticCapture().snapshot,
      checksum: 'a'.repeat(64),
    },
    current: null,
    context: null,
    plan: null,
    report: null,
    previous: null,
    message: RestoreMessage.Unavailable,
    busy: false,
    active: true,
  } satisfies RestoreModel;
}

test.each(Object.values(Locale))(
  'an unavailable destination is explained once, without duplicate metadata messages: %s',
  (locale) => {
    localizePage(locale, document);
    const view = new RestoreView(document);
    const model = preview();
    view.render(model, locale, false, false);
    const message = translations[locale].restoreUnavailable;
    expect(view.element('restore-panel', HTMLElement).textContent?.split(message)).toHaveLength(2);
    expect(view.element('restore-workspace', HTMLElement).hidden).toBe(true);
    expect(view.element('restore-destination', HTMLElement).hidden).toBe(true);
    if (!model.imported) throw new Error('Missing synthetic import');
    const current = model.imported.snapshot;
    view.render(
      {
        ...model,
        current,
        context: {
          boardId: current.board.id,
          workspaceId: 'b'.repeat(24),
          workspaceName: 'Studio',
        },
        plan: buildMergePlan(model.imported, current),
        imported: model.imported,
        message: RestoreMessage.Ready,
      },
      locale,
      true,
      false,
    );
    expect(view.element('restore-workspace', HTMLElement).hidden).toBe(false);
    expect(view.element('restore-workspace', HTMLElement).textContent).toContain('Studio');
    expect(view.element('restore-destination', HTMLElement).hidden).toBe(false);
    expect(view.element('restore-destination', HTMLElement).textContent).toContain(
      current.board.name,
    );
  },
);

test.each(Object.values(Locale))(
  'import has a localized footer with collapsed technical details and dynamic limitations: %s',
  (locale) => {
    localizePage(locale, document);
    const view = new RestoreView(document);
    view.render(preview(), locale, false, false);
    const panel = view.element('restore-panel', HTMLElement);
    const details = panel.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain(translations[locale].restorePermission);
    expect(details?.textContent).toContain(translations[locale].restoreFileLimit);
    expect(details?.contains(view.element('restore-limitations', HTMLElement))).toBe(true);
    expect(view.element('restore-preview', HTMLElement).textContent).not.toContain(
      translations[locale].restoreIdentities,
    );
    expect(panel.querySelector('.workflow-footer')?.textContent).toContain(
      translations[locale].restorePrivacy,
    );
    expect(panel.textContent).toContain(translations[locale].restoreConsistency);
    expect(view.element('restore-start', HTMLButtonElement).textContent).toBe(
      translations[locale].restoreAction,
    );
    view.render(
      { ...preview(), imported: null, message: RestoreMessage.Invalid },
      locale,
      false,
      false,
    );
    expect(view.element('restore-details', HTMLElement).hidden).toBe(true);
    expect(view.element('restore-limitations', HTMLElement).textContent).toBe('');
  },
);
