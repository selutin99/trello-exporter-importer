import { expect, test } from 'vitest';
import { cardTable, csvExport } from '../../src/export/csv';
import { createSyntheticCapture } from '../helpers/board-capture';

test('CSV has one row per card, full quoted multiline text, JSON collections, and a UTF-8 BOM', async () => {
  const snapshot = createSyntheticCapture().snapshot;
  snapshot.cards[0]!.name = 'Unicode café 東京, "quoted"';
  snapshot.cards[0]!.description = 'line one\nline two';
  const blob = csvExport(snapshot);
  expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([239, 187, 191]);
  const text = await blob.text();
  expect(text).toContain('"Unicode café 東京, ""quoted"""');
  expect(text).toContain('"line one\nline two"');
  expect(text).toContain('\r\n');
  const rows = cardTable(snapshot);
  expect(rows).toHaveLength(7);
  expect(JSON.parse(String(rows[1]?.[10]))).toHaveLength(1);
  expect(rows[0]).not.toContain('archived');
  expect(rows[0]).not.toContain('custom_fields');
});
test.each([
  '=HYPERLINK("https://example.com")',
  '+SUM(1,2)',
  '-1+2',
  '@SUM(1,2)',
  ' \t=1+1',
  '\u0000=1+1',
  '\tplain',
])('CSV neutralizes spreadsheet formula prefix %s', async (value) => {
  const snapshot = createSyntheticCapture().snapshot;
  snapshot.cards[0]!.name = value;
  expect(await csvExport(snapshot).text()).toContain('"\'' + value.replaceAll('"', '""') + '"');
});
