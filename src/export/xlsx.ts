import { textChunks } from '../shared/text';
import writeXlsxFile from 'write-excel-file/universal';
import type { CellObject, Sheet } from 'write-excel-file/universal';
import type { Snapshot } from '../snapshot/types';
import type { Locale } from '../i18n';
import { translations } from '../i18n';

type Value = string | number | boolean | Date | null;
interface TextChunk {
  reference: string;
  part: number;
  content: string;
}

function value(raw: unknown): Value {
  let result: Value = null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') result = raw;
  else if (raw !== null && raw !== undefined) result = JSON.stringify(raw);
  return result;
}

function cellValue(raw: unknown, key: string, reference: string, chunks: TextChunk[]): Value {
  let result = value(raw);
  if (typeof result === 'string') {
    if (result.length > 1000) {
      for (const [index, content] of textChunks(result, 1000).entries())
        chunks.push({ reference, part: index + 1, content });
      result = `TextChunks: ${reference}`;
    } else if (
      ['start', 'due', 'createdAt'].includes(key) &&
      result &&
      !Number.isNaN(Date.parse(result))
    )
      result = new Date(result);
  }
  return result;
}
function styledCell(raw: Value, width: number, index: number): CellObject {
  const cell: CellObject = {
    value: raw ?? '',
    type: String,
    fontFamily: 'Arial',
    fontSize: 10,
    textColor: '#172b4d',
    alignVertical: 'top',
    wrap: true,
  };
  if (typeof raw === 'number') cell.type = Number;
  if (typeof raw === 'boolean') cell.type = Boolean;
  if (raw instanceof Date) {
    cell.type = Date;
    cell.format = 'yyyy-mm-dd hh:mm';
  }
  const display = raw instanceof Date ? raw.toISOString().slice(0, 16) : String(raw ?? '');
  const lines = display
    .split('\n')
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / (width - 2))), 0);
  cell.height = Math.min(409, Math.max(22, lines * 16 + 6));
  if (index % 2 === 1) cell.backgroundColor = '#f4f7fb';
  return cell;
}
function columnWidth(key: string): number {
  return ['description', 'text', 'content', 'name', 'value'].includes(key) ? 58 : 28;
}
function sheet(
  workbook: Sheet<Blob>[],
  name: string,
  records: object[],
  keys: string[],
  chunks: TextChunk[],
): void {
  const columns = keys.map((key) => ({ width: columnWidth(key) }));
  const data: CellObject[][] = [
    keys.map((key) => ({
      value: key,
      type: String,
      fontFamily: 'Arial',
      fontSize: 10,
      fontWeight: 'bold',
      backgroundColor: '#172b4d',
      textColor: '#ffffff',
      align: 'center',
      alignVertical: 'center',
      height: 28,
      wrap: true,
      rightBorderColor: '#ffffff',
      rightBorderStyle: 'thin',
    })),
  ];
  for (const [index, record] of records.entries()) {
    const fields = new Map<string, unknown>(Object.entries(record));
    data.push(
      keys.map((key) =>
        styledCell(
          cellValue(fields.get(key), key, `${name}/${index + 2}/${key}`, chunks),
          columnWidth(key),
          index,
        ),
      ),
    );
  }
  workbook.push({
    sheet: name,
    data,
    columns,
    stickyRowsCount: 1,
    stickyColumnsCount: 1,
    showGridLines: false,
    orientation: 'landscape',
  });
}

/**
 * Exports normalized collections as typed worksheets with stable relationship keys
 * @param snapshot - Current board content
 * @param locale - Product language for the overview
 * @returns XLSX bytes with all user strings stored as text, never formulas
 * @throws Error when workbook generation fails
 */
export async function xlsxExport(snapshot: Snapshot, locale: Locale): Promise<Blob> {
  const workbook: Sheet<Blob>[] = [];
  const chunks: TextChunk[] = [];
  const text = translations[locale];
  sheet(
    workbook,
    'Overview',
    [
      { property: text.formatBoard, value: snapshot.board.name },
      { property: 'snapshotId', value: snapshot.snapshotId },
      {
        property: text.formatCapture,
        value: `${snapshot.capture.startedAt} / ${snapshot.capture.completedAt}`,
      },
      { property: text.exportLists, value: snapshot.lists.length },
      { property: text.exportCardCount, value: snapshot.cards.length },
      { property: text.exportItemCount, value: snapshot.checklistItems.length },
      { property: 'description', value: snapshot.board.description },
      { property: 'notes', value: text.formatNotice },
      { property: 'source', value: snapshot.board.url },
    ],
    ['property', 'value'],
    chunks,
  );
  const tables: [string, object[], string[]][] = [
    ['Lists', snapshot.lists, ['id', 'name', 'order']],
    [
      'Cards',
      snapshot.cards,
      ['id', 'listId', 'name', 'description', 'order', 'start', 'due', 'dueComplete', 'cover'],
    ],
    ['Labels', snapshot.labels, ['id', 'name', 'color']],
    ['Members', snapshot.members, ['id', 'username', 'displayName']],
    [
      'CardLabels',
      snapshot.cards.flatMap((card) =>
        card.labelIds.map((labelId) => ({ cardId: card.id, labelId })),
      ),
      ['cardId', 'labelId'],
    ],
    [
      'CardMembers',
      snapshot.cards.flatMap((card) =>
        card.memberIds.map((memberId) => ({ cardId: card.id, memberId })),
      ),
      ['cardId', 'memberId'],
    ],
    ['Checklists', snapshot.checklists, ['id', 'cardId', 'name', 'order']],
    [
      'ChecklistItems',
      snapshot.checklistItems,
      ['id', 'checklistId', 'name', 'order', 'checked', 'due', 'memberId'],
    ],
    [
      'Comments',
      snapshot.comments,
      ['id', 'cardId', 'authorId', 'authorDisplayName', 'createdAt', 'text', 'order'],
    ],
    [
      'Attachments',
      snapshot.attachments,
      ['id', 'cardId', 'name', 'kind', 'url', 'mimeType', 'size'],
    ],
    ['ExportReport', snapshot.issues, ['code', 'severity', 'entityType', 'entityId', 'message']],
  ];
  for (const [name, records, keys] of tables) sheet(workbook, name, records, keys, chunks);
  if (chunks.length) sheet(workbook, 'TextChunks', chunks, ['reference', 'part', 'content'], []);
  return writeXlsxFile(workbook).toBlob();
}
