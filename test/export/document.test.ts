import { expect, test } from 'vitest';
import { documentBlocks, BlockKind } from '../../src/export/document';
import { createSyntheticCapture } from '../helpers/board-capture';
import { Locale } from '../../src/i18n';
import { IssueCode } from '../../src/snapshot/codes';

test('reading formats retain dates, metadata, comments, files, empty lists, and warnings', () => {
  const snapshot = createSyntheticCapture().snapshot;
  snapshot.comments[0]!.authorDisplayName = null;
  snapshot.checklistItems[0]!.due = '2026-11-01T00:00:00Z';
  snapshot.lists.push({ id: 'empty', name: 'Empty list', order: 3, closed: false });
  snapshot.issues.push({
    code: IssueCode.FileUnavailable,
    severity: 'warning',
    entityType: 'attachmentFiles',
    entityId: null,
    message: 'not used',
  });
  const blocks = documentBlocks(snapshot, Locale.Russian);
  expect(blocks.filter((block) => block.kind === BlockKind.Heading)).toHaveLength(6);
  const text = blocks.map((block) => block.text).join('\n');
  expect(text).toContain('Empty list');
  expect(text).toContain('1 нояб. 2026');
  expect(text).toContain('UTC');
  expect(text).toContain('Комментар');
  expect(text).toContain('Synthetic review');
  expect(text).toContain(IssueCode.FileUnavailable);
});
