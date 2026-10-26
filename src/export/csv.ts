import { orderedRecords } from '../snapshot/collections';
import { snapshotRelations } from '../snapshot/relations';
import type { Snapshot } from '../snapshot/types';

/**
 * Flattens one row per card; related collections use JSON inside quoted CSV cells
 * @param snapshot - Normalized board content
 * @returns Stable English headers and data rows in board order
 */
export function cardTable(snapshot: Snapshot): (string | boolean)[][] {
  const relations = snapshotRelations(snapshot);
  const rows: (string | boolean)[][] = [
    [
      'card_id',
      'list_id',
      'list',
      'name',
      'description',
      'start',
      'due',
      'due_complete',
      'labels',
      'members',
      'checklists',
      'comments',
      'attachments',
    ],
  ];
  for (const list of orderedRecords(snapshot.lists)) {
    for (const card of orderedRecords(relations.cards.get(list.id) ?? [])) {
      const checklists = (relations.checklists.get(card.id) ?? []).map((checklist) => ({
        ...checklist,
        items: relations.items.get(checklist.id) ?? [],
      }));
      rows.push([
        card.id,
        list.id,
        list.name,
        card.name,
        card.description,
        card.start ?? '',
        card.due ?? '',
        card.dueComplete,
        JSON.stringify(snapshot.labels.filter((label) => card.labelIds.includes(label.id))),
        JSON.stringify(snapshot.members.filter((member) => card.memberIds.includes(member.id))),
        JSON.stringify(checklists),
        JSON.stringify(relations.comments.get(card.id) ?? []),
        JSON.stringify(relations.attachments.get(card.id) ?? []),
      ]);
    }
  }
  return rows;
}

/**
 * Creates RFC 4180 CSV with a UTF-8 BOM and spreadsheet-formula protection
 * @param snapshot - Captured active board content
 * @returns CSV with quoted cells, CRLF records, and JSON related collections
 */
export function csvExport(snapshot: Snapshot): Blob {
  const text =
    cardTable(snapshot)
      .map((row) =>
        row
          .map((value) => {
            let cell = String(value);
            if (/^[=+\-@]/.test(cell.replace(/^[\p{Cc}\s]*/u, '')) || /^[\t\r\n]/.test(cell))
              cell = "'" + cell;
            return '"' + cell.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n') + '\r\n';
  return new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' });
}
