import type { Locale } from '../../i18n';
import { translations } from '../../i18n';
import { RestoreResource } from '../../restore/codes';
import { mergeRecords } from '../../restore/merge/records';
import { MergeChoice, MergeConflictKind, MergeField } from '../../restore/merge/types';
import type { MergeConflict, MergeValue } from '../../restore/merge/types';
import type { RestoreModel } from './types';

const resourceMessages = {
  [RestoreResource.Board]: 'mergeResourceBoards',
  [RestoreResource.List]: 'mergeResourceLists',
  [RestoreResource.Card]: 'mergeResourceCards',
  [RestoreResource.Label]: 'mergeResourceLabels',
  [RestoreResource.Field]: 'mergeResourceFields',
  [RestoreResource.Option]: 'mergeResourceOptions',
  [RestoreResource.Checklist]: 'mergeResourceChecklists',
  [RestoreResource.Item]: 'mergeResourceItems',
  [RestoreResource.Comment]: 'mergeResourceComments',
  [RestoreResource.Attachment]: 'mergeResourceAttachments',
  [RestoreResource.Value]: 'mergeResourceValues',
} as const;
const fieldMessages = {
  [MergeField.Name]: 'mergeFieldName',
  [MergeField.Description]: 'mergeFieldDescription',
  [MergeField.Parent]: 'mergeFieldParent',
  [MergeField.Labels]: 'mergeFieldLabels',
  [MergeField.Start]: 'mergeFieldStart',
  [MergeField.Due]: 'mergeFieldDue',
  [MergeField.Complete]: 'mergeFieldComplete',
  [MergeField.Checked]: 'mergeFieldChecked',
  [MergeField.Color]: 'mergeFieldColor',
  [MergeField.Type]: 'mergeFieldType',
  [MergeField.Text]: 'mergeFieldText',
  [MergeField.Value]: 'mergeFieldValue',
  [MergeField.Content]: 'mergeFieldContent',
} as const;
function display(value: MergeValue, names: Map<string, string>, locale: Locale): string {
  const text = translations[locale];
  if (value === null || value === '') return text.restoreEmpty;
  if (typeof value === 'boolean') return value ? text.formatYes : text.formatNo;
  if (Array.isArray(value))
    return value.map((item) => display(item, names, locale)).join(', ') || text.restoreEmpty;
  if (typeof value === 'object') {
    if (typeof value.ref === 'string')
      return names.get(value.ref) ?? value.ref.slice(value.ref.lastIndexOf('/') + 1);
    return Object.values(value)
      .map((item) => display(item, names, locale))
      .join('\n');
  }
  return String(value);
}

/**
 * Renders safe field differences and identity choices, preserving keyboard focus across recalculation
 * @param container - Conflict list mount point
 * @param model - Current private comparison state
 * @param locale - Selected UI language
 * @param busy - Whether changes are temporarily blocked
 */
export function renderConflicts(
  container: HTMLElement,
  model: Readonly<RestoreModel>,
  locale: Locale,
  busy: boolean,
): void {
  const document = container.ownerDocument;
  const focused = document.activeElement;
  const activeKey = focused instanceof HTMLSelectElement ? focused.dataset.conflictKey : undefined;
  container.replaceChildren();
  const incoming = model.imported
    ? new Map(mergeRecords(model.imported.snapshot).map((item) => [item.key, item.name]))
    : new Map<string, string>();
  const current = model.current
    ? new Map(mergeRecords(model.current).map((item) => [item.key, item.name]))
    : new Map<string, string>();
  for (const conflict of model.plan?.conflicts ?? []) {
    container.append(conflictCard(conflict, locale, document, busy, current, incoming));
  }
  if (activeKey)
    for (const input of container.querySelectorAll<HTMLSelectElement>('select'))
      if (input.dataset.conflictKey === activeKey) input.focus({ preventScroll: true });
}
function conflictCard(
  conflict: MergeConflict,
  locale: Locale,
  document: Document,
  busy: boolean,
  current: Map<string, string>,
  incoming: Map<string, string>,
): HTMLElement {
  const card = document.createElement('section');
  card.className = 'merge-conflict';
  const title = document.createElement('h4');
  const text = translations[locale];
  const parts = [
    text[resourceMessages[conflict.record.resource]],
    conflict.record.name.slice(0, 140),
  ];
  if (conflict.field) parts.push(text[fieldMessages[conflict.field]]);
  title.textContent = parts.join(' · ');
  card.append(title);
  if (conflict.kind === MergeConflictKind.Value) {
    for (const [label, value, names] of [
      [text.restoreCurrentValue, conflict.current, current],
      [text.restoreSnapshotValue, conflict.incoming, incoming],
    ] as const) {
      const heading = document.createElement('strong');
      heading.textContent = label;
      const content = document.createElement('pre');
      content.textContent = display(value, names, locale);
      card.append(heading, content);
    }
  }
  card.append(resolutionSelect(conflict, locale, document, busy));
  return card;
}
function resolutionSelect(
  conflict: MergeConflict,
  locale: Locale,
  document: Document,
  busy: boolean,
): HTMLElement {
  const text = translations[locale];
  const label = document.createElement('label');
  label.textContent =
    conflict.kind === MergeConflictKind.Identity ? text.restoreMatch : text.restoreSelectResolution;
  const select = document.createElement('select');
  select.dataset.conflictKey = conflict.key;
  select.disabled = busy;
  const choices: [string, string][] = [['', text.restoreSelectResolution]];
  if (conflict.kind === MergeConflictKind.Identity) {
    choices.push(
      ...conflict.candidates.map((item): [string, string] => [
        item.id,
        `${item.name.slice(0, 100)} · ${item.id}`,
      ]),
    );
    choices.push(
      [MergeChoice.Create, text.restoreCreateSeparate],
      [MergeChoice.Skip, text.restoreSkip],
    );
  } else {
    const copy = [RestoreResource.Attachment, RestoreResource.Comment].includes(
      conflict.record.resource,
    );
    choices.push(
      [MergeChoice.Current, text.restoreKeepCurrent],
      [MergeChoice.Snapshot, copy ? text.restoreUseCopy : text.restoreUseSnapshot],
    );
  }
  for (const [value, title] of choices) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = title;
    select.append(option);
  }
  select.value = conflict.resolution ?? '';
  label.append(select);
  return label;
}
