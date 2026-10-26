// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { xlsxExport } from '../../src/export/xlsx';
import { createSyntheticCapture } from '../helpers/board-capture';
import { Locale } from '../../src/i18n';

test('XLSX stores related sheets, typed dates/booleans, literal formula-like strings, and frozen headers', async () => {
  const snapshot = createSyntheticCapture().snapshot;
  snapshot.cards[0]!.name = '=HYPERLINK("https://example.com")';
  const blob = await xlsxExport(snapshot, Locale.Russian);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = unzipSync(bytes);
  const xml = (path: string) => strFromU8(entries[path]!);
  expect(xml('xl/workbook.xml')).toContain('ChecklistItems');
  expect(xml('xl/workbook.xml')).not.toContain('CustomField');
  const worksheet = xml('xl/worksheets/sheet3.xml');
  expect(worksheet).toContain('ySplit="1"');
  expect(worksheet).toContain('t="b"');
  expect(worksheet).not.toContain('<f>');
  expect(worksheet.match(/<row /g)).toHaveLength(7);
  const strings = xml('xl/sharedStrings.xml');
  expect(strings).toContain('=HYPERLINK(');
  expect(xml('xl/styles.xml')).toContain('yyyy-mm-dd hh:mm');
  if (process.env.EXPORT_QA_DIRECTORY) {
    await mkdir(process.env.EXPORT_QA_DIRECTORY, { recursive: true });
    await writeFile(`${process.env.EXPORT_QA_DIRECTORY}/board.xlsx`, bytes);
  }
});
test('long spreadsheet text is preserved in ordered continuation rows rather than silently truncated', async () => {
  const snapshot = createSyntheticCapture().snapshot;
  const content = 'x'.repeat(999) + '🙂' + 'Long text café 東京\n'.repeat(2000);
  snapshot.cards[0]!.description = content;
  const entries = unzipSync(
    new Uint8Array(await (await xlsxExport(snapshot, Locale.English)).arrayBuffer()),
  );
  const xml = strFromU8(entries['xl/sharedStrings.xml']!);
  expect(xml).toContain('TextChunks: Cards/2/description');
  expect(strFromU8(entries['xl/workbook.xml']!)).toContain('TextChunks');
  const strings = [
    ...new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('si'),
  ].map((item) => item.textContent ?? '');
  const doc = new DOMParser().parseFromString(
    strFromU8(entries['xl/worksheets/sheet13.xml']!),
    'application/xml',
  );
  const rows = [...doc.getElementsByTagName('row')].slice(1);
  const reconstructed = rows
    .map((row) => {
      const cell = row.getElementsByTagName('c')[2]!;
      const index = Number(cell.getElementsByTagName('v')[0]?.textContent);
      return strings[index];
    })
    .join('');
  expect(reconstructed).toBe(content);
});
