import { expect, test } from 'vitest';
import { createLegacyFieldCapture as createSyntheticCapture } from '../helpers/board-capture';
import { parseSnapshot } from '../../src/import/schema';
import { ImportError } from '../../src/import/codes';
import type { Snapshot } from '../../src/snapshot/types';
import { CustomFieldType } from '../../src/snapshot/codes';

const cases: [string, (snapshot: Snapshot) => void][] = [
  [
    'duplicate IDs',
    (s) => {
      s.cards.push(s.cards[0]!);
    },
  ],
  [
    'list reference',
    (s) => {
      s.cards[0]!.listId = 'missing';
    },
  ],
  [
    'member reference',
    (s) => {
      s.cards[0]!.memberIds = ['missing'];
    },
  ],
  [
    'label reference',
    (s) => {
      s.cards[0]!.labelIds = ['missing'];
    },
  ],
  [
    'checklist reference',
    (s) => {
      s.checklistItems[0]!.checklistId = 'missing';
    },
  ],
  [
    'checklist assignee',
    (s) => {
      s.checklistItems[0]!.memberId = 'missing';
    },
  ],
  [
    'comment reference',
    (s) => {
      s.comments[0]!.cardId = 'missing';
    },
  ],
  [
    'attachment reference',
    (s) => {
      s.attachments[0]!.cardId = 'missing';
    },
  ],
  [
    'field reference',
    (s) => {
      s.customFieldValues[0]!.fieldId = 'missing';
    },
  ],
  [
    'option reference',
    (s) => {
      s.customFieldValues[0]!.optionId = 'missing';
    },
  ],
  [
    'field value type',
    (s) => {
      s.customFields[0]!.type = CustomFieldType.Checkbox;
      s.customFieldValues[0]!.value = { checked: 'invalid' };
    },
  ],
  [
    'contradictory field value',
    (s) => {
      s.customFieldValues[0]!.value = { text: 'text', checked: 'true' };
    },
  ],
  [
    'duplicate field values',
    (s) => {
      s.customFieldValues.push(s.customFieldValues[0]!);
    },
  ],
  [
    'sibling order',
    (s) => {
      s.cards[0]!.order = 10;
    },
  ],
  [
    'coverage count',
    (s) => {
      s.coverage.cards!.count = 0;
    },
  ],
  [
    'archived cards',
    (s) => {
      s.cards[0]!.closed = true;
    },
  ],
  [
    'unsafe attachment URL',
    (s) => {
      s.attachments[0]!.url = 'javascript:alert(1)';
    },
  ],
  [
    'credential URL',
    (s) => {
      s.attachments[0]!.url = 'https://example.com/?token=secret';
    },
  ],
];
test.each(cases)('%s cannot pass import validation', (_name, mutate) => {
  const snapshot = createSyntheticCapture().snapshot;
  mutate(snapshot);
  expect(() => parseSnapshot(snapshot)).toThrow(ImportError);
});
test('unknown optional root fields are projected away and optional metadata remains compatible', () => {
  const source = createSyntheticCapture().snapshot;
  expect(parseSnapshot({ ...source, unknown: { apiOrigin: 'https://attacker.example' } })).toEqual(
    source,
  );
});

test.each([
  [CustomFieldType.Text, { text: 'Literal content' }],
  [CustomFieldType.Number, { number: '-12.50' }],
  [CustomFieldType.Date, { date: '2026-11-01T12:00:00Z' }],
  [CustomFieldType.Checkbox, { checked: 'false' }],
] as const)('supported %s field values retain their API representation', (type, value) => {
  const snapshot = createSyntheticCapture().snapshot;
  const field = snapshot.customFields[1]!;
  field.type = type;
  for (const record of snapshot.customFieldValues.filter((item) => item.fieldId === field.id))
    record.value = value;
  expect(parseSnapshot(snapshot)).toEqual(snapshot);
});
