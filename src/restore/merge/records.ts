import type { Snapshot } from '../../snapshot/types';
import { AttachmentKind } from '../../snapshot/codes';
import { orderedRecords } from '../../snapshot/collections';
import { RestoreResource } from '../codes';
import { MergeField } from './types';
import type { MergeRecord, MergeValue } from './types';

/**
 * Creates a stable relationship key distinct from a Trello target identity
 * @param resource - Object collection
 * @param id - Snapshot identity
 * @returns A namespaced source key
 */
export const recordKey = (resource: RestoreResource, id: string): string => `${resource}/${id}`;
/**
 * Represents a relationship without confusing user text with object identities
 * @param key - Namespaced relationship key
 * @returns An internal symbolic reference
 */
export const reference = (key: string): MergeValue => ({ ref: key });

/**
 * Projects supported mutable content in dependency order; board identity and existing positions are preserved
 * @param snapshot - Validated active-board content
 * @returns Merge records without private file bytes or authorization data
 */
export function mergeRecords(snapshot: Snapshot): MergeRecord[] {
  const records: MergeRecord[] = [];
  const add = (
    resource: RestoreResource,
    id: string,
    name: string,
    parent: string | null,
    fields: MergeRecord['fields'],
  ) => records.push({ key: recordKey(resource, id), resource, sourceId: id, name, parent, fields });
  const board = recordKey(RestoreResource.Board, snapshot.board.id);
  add(RestoreResource.Board, snapshot.board.id, snapshot.board.name, null, {
    [MergeField.Description]: snapshot.board.description,
  });
  for (const label of snapshot.labels)
    add(RestoreResource.Label, label.id, label.name, board, {
      [MergeField.Name]: label.name,
      [MergeField.Color]: label.color,
    });
  for (const list of orderedRecords(snapshot.lists))
    add(RestoreResource.List, list.id, list.name, board, {
      [MergeField.Name]: list.name,
    });
  for (const card of orderedRecords(snapshot.cards))
    add(RestoreResource.Card, card.id, card.name, recordKey(RestoreResource.List, card.listId), {
      [MergeField.Name]: card.name,
      [MergeField.Description]: card.description,
      [MergeField.Parent]: reference(recordKey(RestoreResource.List, card.listId)),
      [MergeField.Labels]: card.labelIds.map((id) =>
        reference(recordKey(RestoreResource.Label, id)),
      ),
      [MergeField.Start]: card.start,
      [MergeField.Due]: card.due,
      [MergeField.Complete]: card.dueComplete,
    });
  for (const list of orderedRecords(snapshot.checklists))
    add(
      RestoreResource.Checklist,
      list.id,
      list.name,
      recordKey(RestoreResource.Card, list.cardId),
      { [MergeField.Name]: list.name },
    );
  for (const item of orderedRecords(snapshot.checklistItems))
    add(
      RestoreResource.Item,
      item.id,
      item.name,
      recordKey(RestoreResource.Checklist, item.checklistId),
      {
        [MergeField.Name]: item.name,
        [MergeField.Checked]: item.checked,
        ...(item.due !== undefined ? { [MergeField.Due]: item.due } : {}),
      },
    );
  for (const comment of orderedRecords(snapshot.comments))
    add(
      RestoreResource.Comment,
      comment.id,
      comment.text,
      recordKey(RestoreResource.Card, comment.cardId),
      { [MergeField.Text]: comment.text },
    );
  for (const attachment of snapshot.attachments)
    add(
      RestoreResource.Attachment,
      attachment.id,
      attachment.name,
      recordKey(RestoreResource.Card, attachment.cardId),
      {
        [MergeField.Content]: {
          name: attachment.name,
          kind: attachment.kind,
          size: attachment.size,
          mimeType: attachment.mimeType,
          ...(attachment.kind === AttachmentKind.Link ? { url: attachment.url } : {}),
        },
      },
    );
  return records;
}
