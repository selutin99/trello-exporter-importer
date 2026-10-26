import { groupRecords, snapshotCollections } from '../snapshot/collections';
import { CoverageStatus, CustomFieldType, SnapshotSection } from '../snapshot/codes';
import { z } from 'zod';
import type { Snapshot } from '../snapshot/types';
import { ImportError, ImportErrorCode } from './codes';

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new ImportError(ImportErrorCode.InvalidReferences);
}
function identities(values: { id: string }[]): Set<string> {
  const result = new Set(values.map((item) => item.id));
  requireValid(result.size === values.length);
  return result;
}
function siblingOrder(values: { order: number }[]): void {
  const sorted = values.map((item) => item.order).sort((a, b) => a - b);
  requireValid(sorted.every((value, index) => value === index));
}
function children<T extends { order: number }>(values: T[], parent: (value: T) => string): void {
  const groups = groupRecords(values, parent);
  groups.forEach(siblingOrder);
}

const fieldValues = new Map<string, z.ZodType>([
  [CustomFieldType.Text, z.object({ text: z.string() }).strict()],
  [
    CustomFieldType.Number,
    z.object({ number: z.string().regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/) }).strict(),
  ],
  [CustomFieldType.Date, z.object({ date: z.iso.datetime({ offset: true }) }).strict()],
  [CustomFieldType.Checkbox, z.object({ checked: z.enum(['true', 'false']) }).strict()],
]);
function customValues(snapshot: Snapshot, cards: Set<string>): void {
  const fields = new Map(snapshot.customFields.map((field) => [field.id, field]));
  const values = new Set<string>();
  for (const value of snapshot.customFieldValues) {
    const field = fields.get(value.fieldId);
    const key = `${value.cardId}/${value.fieldId}`;
    requireValid(cards.has(value.cardId) && field && !values.has(key));
    values.add(key);
    if (value.value === undefined && value.optionId === undefined) continue;
    if (field.type === CustomFieldType.List) {
      requireValid(
        value.value === undefined && field.options.some((option) => option.id === value.optionId),
      );
    } else {
      requireValid(
        value.optionId === undefined &&
          fieldValues.get(field.type)?.safeParse(value.value).success === true,
      );
    }
  }
}

/**
 * Rejects duplicate IDs, dangling references, invalid order, and contradictory coverage
 * @param snapshot - Structurally validated snapshot
 * @throws ImportError when the normalized model is inconsistent
 */
export function validateReferences(snapshot: Snapshot): void {
  const lists = identities(snapshot.lists);
  const cards = identities(snapshot.cards);
  const labels = identities(snapshot.labels);
  const members = identities(snapshot.members);
  const checklists = identities(snapshot.checklists);
  identities(snapshot.checklistItems);
  identities(snapshot.comments);
  identities(snapshot.attachments);
  identities(snapshot.customFields);
  siblingOrder(snapshot.lists);
  children(snapshot.cards, (card) => card.listId);
  children(snapshot.checklists, (checklist) => checklist.cardId);
  children(snapshot.checklistItems, (item) => item.checklistId);
  children(snapshot.comments, (comment) => comment.cardId);
  siblingOrder(snapshot.customFields);
  snapshot.customFields.forEach((field) => {
    identities(field.options);
    siblingOrder(field.options);
  });
  requireValid(
    snapshot.cards.every(
      (card) =>
        lists.has(card.listId) &&
        card.labelIds.every((id) => labels.has(id)) &&
        card.memberIds.every((id) => members.has(id)),
    ),
  );
  requireValid(snapshot.checklists.every((list) => cards.has(list.cardId)));
  requireValid(
    snapshot.checklistItems.every(
      (item) => checklists.has(item.checklistId) && (!item.memberId || members.has(item.memberId)),
    ),
  );
  requireValid(snapshot.comments.every((comment) => cards.has(comment.cardId)));
  requireValid(snapshot.attachments.every((attachment) => cards.has(attachment.cardId)));
  customValues(snapshot, cards);
  for (const section of snapshotCollections) {
    const records = snapshot[section];
    const coverage = snapshot.coverage[section];
    requireValid(
      !!coverage &&
        coverage.count === records.length &&
        (coverage.status !== CoverageStatus.Excluded || records.length === 0),
    );
  }
  requireValid(snapshot.coverage[SnapshotSection.Board]?.count === 1);
  requireValid(snapshot.coverage[SnapshotSection.AttachmentFiles]?.count === 0);
}
