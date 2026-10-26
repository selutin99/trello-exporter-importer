import type { Snapshot } from './types';
import { groupRecords } from './collections';

type Related<T> = ReadonlyMap<string, readonly T[]>;
export interface SnapshotRelations {
  cards: Related<Snapshot['cards'][number]>;
  checklists: Related<Snapshot['checklists'][number]>;
  items: Related<Snapshot['checklistItems'][number]>;
  comments: Related<Snapshot['comments'][number]>;
  attachments: Related<Snapshot['attachments'][number]>;
}

/**
 * Indexes snapshot relationships while preserving record content and source order
 * @param snapshot - Normalized content whose collections stay fixed during consumption
 * @returns Parent groups for supported board content
 */
export function snapshotRelations(snapshot: Snapshot): SnapshotRelations {
  return {
    cards: groupRecords(snapshot.cards, (card) => card.listId),
    checklists: groupRecords(snapshot.checklists, (checklist) => checklist.cardId),
    items: groupRecords(snapshot.checklistItems, (item) => item.checklistId),
    comments: groupRecords(snapshot.comments, (comment) => comment.cardId),
    attachments: groupRecords(snapshot.attachments, (attachment) => attachment.cardId),
  };
}
